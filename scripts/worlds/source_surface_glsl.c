#define GL_SILENCE_DEPRECATION
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static GLuint shader(const char *filename,GLenum type){
 FILE *f=fopen(filename,"rb");if(!f)exit(2);fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
 char *text=calloc(n+1,1);if(!text||fread(text,1,n,f)!=(size_t)n)exit(2);fclose(f);
 char *p=strstr(text,"#version 300 es");if(p)memcpy(p,"#version 410   ",15);
 p=strstr(text,"precision highp float;");if(p)memset(p,' ',22);
 p=strstr(text,"precision highp int;");if(p)memset(p,' ',20);
 GLuint s=glCreateShader(type);glShaderSource(s,1,(const GLchar**)&text,NULL);glCompileShader(s);free(text);
 GLint ok;glGetShaderiv(s,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192];glGetShaderInfoLog(s,sizeof(log),NULL,log);fprintf(stderr,"%s\n",log);exit(3);}return s;
}
int main(int argc,char **argv){
 if(argc!=4)return 2;
 FILE *f=fopen(argv[3],"rb");if(!f)return 2;char magic[8];uint32_t size[2];
 if(fread(magic,1,8,f)!=8||memcmp(magic,"IMGSURF1",8)||fread(size,4,2,f)!=2)return 2;
 int width=size[0],height=size[1];if(width<16||width>1024||height!=width)return 2;
 size_t instances=(size_t)width*height,bytes=instances*20;unsigned char *data=malloc(bytes);
 if(!data||fread(data,1,bytes,f)!=bytes||fgetc(f)!=EOF)return 2;fclose(f);
 CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,kCGLPFAAccelerated,(CGLPixelFormatAttribute)0};
 CGLPixelFormatObj format;CGLContextObj context;GLint count;
 if(CGLChoosePixelFormat(attrs,&format,&count)||CGLCreateContext(format,NULL,&context)||CGLSetCurrentContext(context))return 4;
 GLuint program=glCreateProgram();glAttachShader(program,shader(argv[1],GL_VERTEX_SHADER));glAttachShader(program,shader(argv[2],GL_FRAGMENT_SHADER));glLinkProgram(program);
 GLint ok;glGetProgramiv(program,GL_LINK_STATUS,&ok);if(!ok){char log[8192];glGetProgramInfoLog(program,sizeof(log),NULL,log);fprintf(stderr,"%s\n",log);return 5;}glUseProgram(program);
 GLuint vao,buffer,texture,framebuffer,depth;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&buffer);glBindBuffer(GL_ARRAY_BUFFER,buffer);glBufferData(GL_ARRAY_BUFFER,bytes,data,GL_STATIC_DRAW);free(data);
 glEnableVertexAttribArray(0);glVertexAttribPointer(0,4,GL_UNSIGNED_BYTE,GL_TRUE,20,(void*)0);glVertexAttribDivisor(0,1);
 glEnableVertexAttribArray(1);glVertexAttribPointer(1,4,GL_FLOAT,GL_FALSE,20,(void*)4);glVertexAttribDivisor(1,1);
 glGenTextures(1,&texture);glBindTexture(GL_TEXTURE_2D,texture);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);
 glGenFramebuffers(1,&framebuffer);glBindFramebuffer(GL_FRAMEBUFFER,framebuffer);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);
 glGenRenderbuffers(1,&depth);glBindRenderbuffer(GL_RENDERBUFFER,depth);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,width,height);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)return 6;
 glViewport(0,0,width,height);glDisable(GL_DITHER);glDisable(GL_BLEND);glEnable(GL_DEPTH_TEST);
 glUniform2f(glGetUniformLocation(program,"uSourceSize"),width,height);glUniform2f(glGetUniformLocation(program,"uViewport"),width,height);
 unsigned char *pixels=malloc(instances*4);float packet[6];
 while(fread(packet,4,6,stdin)==6){
  glUniform3fv(glGetUniformLocation(program,"uCamera"),1,packet);glUniform2fv(glGetUniformLocation(program,"uLook"),1,packet+3);glUniform1f(glGetUniformLocation(program,"uRelief"),packet[5]);
  glClearColor(.055,.071,.09,1.);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);glDrawArraysInstanced(GL_TRIANGLES,0,6,instances);glFinish();glReadPixels(0,0,width,height,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
  uint32_t error=glGetError();if(fwrite(&error,4,1,stdout)!=1||fwrite(pixels,1,instances*4,stdout)!=instances*4)return 7;fflush(stdout);
 }
 free(pixels);CGLSetCurrentContext(NULL);CGLDestroyContext(context);CGLDestroyPixelFormat(format);return 0;
}
