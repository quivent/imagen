#define GL_SILENCE_DEPRECATION
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *source(const char *path) {
 FILE *file=fopen(path,"rb");if(!file)return NULL;
 fseek(file,0,SEEK_END);long size=ftell(file);rewind(file);
 char *text=calloc((size_t)size+1,1);if(!text)exit(2);
 if(fread(text,1,(size_t)size,file)!=(size_t)size)exit(2);fclose(file);
 char *line=strstr(text,"#version 300 es");if(line)memcpy(line,"#version 410   ",15);
 line=strstr(text,"precision highp float;");if(line)memset(line,' ',22);
 return text;
}
static GLuint compile(const char *path,GLenum kind){
 char *text=source(path);if(!text)exit(2);
 GLuint result=glCreateShader(kind);glShaderSource(result,1,(const GLchar **)&text,NULL);glCompileShader(result);free(text);
 GLint ok;glGetShaderiv(result,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192];glGetShaderInfoLog(result,sizeof(log),NULL,log);fprintf(stderr,"%s\n",log);exit(3);}return result;
}
int main(int argc,char **argv){
 if(argc!=5)return 2;
 int width=atoi(argv[3]),height=atoi(argv[4]);if(width<16||height<16||width>2048||height>2048)return 2;
 CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,kCGLPFAAccelerated,(CGLPixelFormatAttribute)0};
 CGLPixelFormatObj format=NULL;CGLContextObj context=NULL;GLint count=0;
 if(CGLChoosePixelFormat(attrs,&format,&count)||CGLCreateContext(format,NULL,&context)||CGLSetCurrentContext(context))return 4;
 GLuint program=glCreateProgram();glAttachShader(program,compile(argv[1],GL_VERTEX_SHADER));glAttachShader(program,compile(argv[2],GL_FRAGMENT_SHADER));glLinkProgram(program);
 GLint linked;glGetProgramiv(program,GL_LINK_STATUS,&linked);if(!linked){char log[8192];glGetProgramInfoLog(program,sizeof(log),NULL,log);fprintf(stderr,"%s\n",log);return 5;}glUseProgram(program);
 const char *names[]={"uG[0]","uPalmA[0]","uPalmB[0]","uPalmC[0]","uBuildingA[0]","uBuildingB[0]","uBuildingC[0]","uFieldA[0]","uFieldB[0]","uFieldC[0]","uRidgeA[0]","uRidgeB[0]","uBankA[0]","uBankB[0]"};
 int sizes[]={16,16,16,16,24,24,24,16,16,16,8,8,6,6};GLint locations[14];
 for(int i=0;i<14;i++){locations[i]=glGetUniformLocation(program,names[i]);if(locations[i]<0){fprintf(stderr,"Inactive required uniform: %s\n",names[i]);return 6;}}
 GLuint vao,framebuffer,texture;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenTextures(1,&texture);glBindTexture(GL_TEXTURE_2D,texture);
 glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glGenFramebuffers(1,&framebuffer);glBindFramebuffer(GL_FRAMEBUFFER,framebuffer);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);
 if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)return 7;
 glViewport(0,0,width,height);glPixelStorei(GL_PACK_ALIGNMENT,1);glUniform2f(glGetUniformLocation(program,"uResolution"),width,height);
 size_t bytes=(size_t)width*height*4;unsigned char *pixels=malloc(bytes);float packet[853];
 if(!pixels)return 8;
 while(fread(packet,sizeof(float),853,stdin)==853){
  int offset=0;
  for(int i=0;i<14;i++){glUniform4fv(locations[i],sizes[i],packet+offset);offset+=sizes[i]*4;}
  glUniform2fv(glGetUniformLocation(program,"uPosition"),1,packet+848);glUniform2fv(glGetUniformLocation(program,"uLook"),1,packet+850);glUniform1f(glGetUniformLocation(program,"uTime"),packet[852]);
  glDrawArrays(GL_TRIANGLES,0,3);glFinish();glReadPixels(0,0,width,height,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
  uint32_t error=glGetError();if(fwrite(&error,sizeof(error),1,stdout)!=1||fwrite(pixels,1,bytes,stdout)!=bytes)return 9;fflush(stdout);
 }
 free(pixels);CGLSetCurrentContext(NULL);CGLDestroyContext(context);CGLDestroyPixelFormat(format);return 0;
}
