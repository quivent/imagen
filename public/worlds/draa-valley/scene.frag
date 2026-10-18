#version 300 es
precision highp float;
out vec4 color;
uniform vec2 uResolution;
uniform vec2 uPosition;
uniform vec2 uLook;
uniform float uTime;
uniform vec4 uG[16];
uniform vec4 uPalmA[16],uPalmB[16],uPalmC[16];
uniform vec4 uBuildingA[24],uBuildingB[24],uBuildingC[24];
uniform vec4 uFieldA[16],uFieldB[16],uFieldC[16];
uniform vec4 uRidgeA[8],uRidgeB[8];
uniform vec4 uBankA[6],uBankB[6];
float palmGround[16];
float buildingGround[24];
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){return .55*noise(p)+uG[13].w*noise(p*2.03)+.14*noise(p*4.09);}
vec2 turn(vec2 p,float a){float s=sin(a),c=cos(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
vec4 bank(float z){
 vec4 outValue=vec4(0);float total=0.;
 for(int i=0;i<6;i++){float weight=exp(-pow((z-uBankA[i].x)/max(uBankA[i].w,.1),2.));outValue+=vec4(uBankA[i].y,uBankA[i].z,uBankB[i].x,uBankB[i].y)*weight;total+=weight;}
 return outValue/max(total,.0001);
}
float channel(float z){return uG[11].y*sin(z*uG[11].z)+uG[11].w*sin(z*.13)+bank(z).y;}
float terrain(vec2 p){
 vec4 section=bank(p.y);float side=abs(p.x-channel(p.y));
 float hills=pow(max(0.,abs(p.x)*uG[13].x-.75),1.35)*6.;
 hills+=smoothstep(uG[13].y,uG[13].y+38.,-p.y)*uG[13].z*.2;
 for(int i=0;i<8;i++){
  vec2 q=turn(p-uRidgeA[i].xy,uRidgeB[i].y);q.y*=uRidgeB[i].x;
  float bump=exp(-dot(q,q)/pow(max(uRidgeA[i].w,.2),2.));
  hills+=bump*uRidgeA[i].z*(.7+uRidgeB[i].z*.25*fbm(p*uG[10].w));
 }
 float edge=side-(uG[11].x*section.x+section.w*noise(p*4.));
 return mix(-uG[12].y,uG[12].z+section.z+hills+.1*noise(p*.7),smoothstep(0.,uG[12].w,edge));
}
float box(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float segment(vec3 p,vec3 a,vec3 b,float r){vec3 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),.0001),0.,1.))-r;}
vec2 choose(vec2 a,vec2 b){return a.x<b.x?a:b;}
vec2 palm(vec3 p,int id){
 vec4 a=uPalmA[id],b=uPalmB[id],c=uPalmC[id];
 vec2 bend=b.xy*pow(clamp(p.y/max(a.z,.1),0.,1.),1.5);
 float trunk=max(length(p.xz-bend)-a.w*(1.-.35*clamp(p.y/a.z,0.,1.)),max(-p.y,p.y-a.z));
 vec2 result=vec2(trunk,3.);vec3 top=vec3(b.x,a.z,b.y);
 if(length(p-top)<b.z+abs(c.x)+abs(b.w)+.5){
  for(int j=0;j<12;j++){
   if(float(j)>=c.z)break;
   float angle=float(j)*6.28318/max(c.z,1.)+c.w;
   vec3 dir=vec3(cos(angle),0,sin(angle));
   vec3 mid=top+dir*b.z*.5+vec3(0,b.w,0),tip=top+dir*b.z-vec3(0,c.x,0);
   float stem=min(segment(p,top,mid,c.y),segment(p,mid,tip,c.y*.65));
   float feather=max(abs(dot(p-mid,vec3(-dir.z,0,dir.x)))-c.y*2.5,abs(p.y-mid.y+max(dot(p-mid,dir),0.)*.35)-c.y*.35);
   feather=max(feather,abs(dot(p-mid,dir))-b.z*.38);
   result=choose(result,vec2(min(stem,feather),4.));
  }
 }
 return result;
}
vec2 scene(vec3 p){
 float h=terrain(p.xz);vec2 result=vec2((p.y-h)*.32,1.);
 for(int i=0;i<16;i++){
  vec4 a=uPalmA[i],b=uPalmB[i];
  if(length(p.xz-a.xy)<b.z+length(b.xy)+1.)result=choose(result,palm(p-vec3(a.x,palmGround[i],a.y),i));
 }
 for(int i=0;i<24;i++){
  vec4 a=uBuildingA[i],b=uBuildingB[i];vec2 local=turn(p.xz-a.xy,b.y);
  if(length(local)>length(a.zw)+2.)continue;
  vec3 q=vec3(local.x,p.y-buildingGround[i],local.y);
  float wall=box(q-vec3(0,b.x*.5,0),vec3(a.z*.5,b.x*.5,a.w*.5));
  float rim=box(q-vec3(0,b.x+b.z*.5,0),vec3(a.z*.5+b.w,b.z*.5,a.w*.5+b.w));
  float inside=box(q-vec3(0,b.x+b.z*.5,0),vec3(max(.01,a.z*.5-b.w),b.z,max(.01,a.w*.5-b.w)));
  result=choose(result,vec2(min(wall,max(rim,-inside)),40.+float(i)));
 }
 for(int i=0;i<16;i++){
  vec4 a=uFieldA[i],b=uFieldB[i];vec2 q=turn(p.xz-a.xy,b.x);
  if(abs(q.x)>a.z*.5 || abs(q.y)>a.w*.5)continue;
  float edge=min(a.z*.5-abs(q.x),a.w*.5-abs(q.y));
  float bed=step(b.z,edge)*(.7+.3*sin(q.y/max(b.y,.02)*6.28318));
  float crop=box(vec3(q.x,p.y-h-b.w*bed*.5,q.y),vec3(a.z*.5,b.w*bed*.5,a.w*.5));
  result=choose(result,vec2(crop,10.+float(i)));
 }
 return result;
}
vec3 normalAt(vec3 p,float t){float e=max(.003,t*.0002);vec2 k=vec2(e,0);return normalize(vec3(scene(p+k.xyy).x-scene(p-k.xyy).x,scene(p+k.yxy).x-scene(p-k.yxy).x,scene(p+k.yyx).x-scene(p-k.yyx).x));}
vec3 sunDirection(){return normalize(uG[0].xyz);}
vec3 sky(vec3 rd){float horizon=pow(1.-max(rd.y,0.),uG[4].w);return mix(uG[4].rgb,uG[5].rgb,horizon)+uG[1].rgb*pow(max(dot(rd,sunDirection()),0.),uG[5].w)*.8;}
float shadow(vec3 p,vec3 rd){float shade=1.,t=.08;for(int i=0;i<22;i++){float d=scene(p+rd*t).x;shade=min(shade,uG[14].w*d/t);t+=clamp(d,.12,2.);if(d<.005||t>20.)break;}return clamp(shade,.12,1.);}
vec3 material(vec3 p,float id,vec3 n){
 float grain=noise(p.xz*uG[9].w+p.y*3.);vec3 c=uG[8].rgb;
 if(id<2.){
  c=mix(uG[8].rgb,uG[10].rgb,clamp(p.y*.035,0.,1.));
  float wet=0.,total=0.,scale=0.;
  for(int i=0;i<6;i++){float w=exp(-pow((p.z-uBankA[i].x)/max(uBankA[i].w,.1),2.));wet+=uBankB[i].z*w;scale+=uBankB[i].w*w;total+=w;}
  float edge=abs(p.x-channel(p.z))-uG[11].x*bank(p.z).x;
  c=mix(uG[9].rgb,c,smoothstep(0.,max(wet/max(total,.001),.01),edge));c*=scale/max(total,.001);
  float ridgeColor=0.,weight=0.;
  for(int i=0;i<8;i++){float w=exp(-dot(p.xz-uRidgeA[i].xy,p.xz-uRidgeA[i].xy)/pow(uRidgeA[i].w,2.));ridgeColor+=uRidgeB[i].w*w;weight+=w;}
  c*=mix(1.,ridgeColor/max(weight,.001),clamp(p.y*.02,0.,.6));
 }else if(id<4.)c=vec3(.29,.20,.11)*(.8+.2*sin(p.y*22.));
 else if(id<5.)c=mix(vec3(.12,.22,.07),vec3(.32,.36,.12),grain);
 else if(id<30.){int i=int(id)-10;vec4 a=uFieldA[i],b=uFieldB[i],d=uFieldC[i];vec2 q=turn(p.xz-a.xy,b.x);float edge=min(a.z*.5-abs(q.x),a.w*.5-abs(q.y));c=mix(uG[8].rgb,d.rgb,smoothstep(0.,b.z,edge))*(1.-d.w*.5+d.w*noise(q*5.));}
 else{int i=int(id)-40;vec4 a=uBuildingA[i],b=uBuildingB[i],d=uBuildingC[i];vec2 q=turn(p.xz-a.xy,b.y);float y=p.y-buildingGround[i];c=vec3(.61,.38,.22)*d.x;float face=q.x+q.y;float windows=step(abs(fract(face/max(d.w,.1))-.5),d.y*.5)*step(abs(fract(y/max(d.w,.1))-.5),d.z*.5);if(y>1.1&&abs(n.y)<.3)c*=1.-windows*.72;}
 return c*(1.-uG[8].w*.5+uG[8].w*grain);
}
void main(){
 for(int i=0;i<16;i++)palmGround[i]=terrain(uPalmA[i].xy);
 for(int i=0;i<24;i++)buildingGround[i]=terrain(uBuildingA[i].xy);
 vec2 uv=(gl_FragCoord.xy-.5*uResolution)/uResolution.y;
 vec3 ro=vec3(uPosition.x,terrain(uPosition)+uG[15].x,uPosition.y);
 vec3 forward=vec3(sin(uLook.x)*cos(uLook.y),sin(uLook.y),-cos(uLook.x)*cos(uLook.y));
 vec3 right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward);
 vec3 rd=normalize(forward*uG[15].y+uv.x*right+uv.y*up);
 float t=.04;vec2 hit;
 for(int i=0;i<160;i++){hit=scene(ro+rd*t);if(hit.x<max(.003,t*uG[15].w)||t>uG[15].z)break;t+=clamp(hit.x,.008,2.5);}
 vec3 col=sky(rd);float waterT=(uG[12].x-ro.y)/rd.y;vec3 wp=ro+rd*waterT;
 bool water=rd.y<0.&&waterT>0.&&waterT<t&&abs(wp.x-channel(wp.z))<uG[11].x*bank(wp.z).x&&wp.z> -80.;
 if(water){vec3 wn=normalize(vec3(uG[7].x*sin(wp.z*uG[7].y+uTime*uG[7].w),1.,uG[7].x*.6*sin(wp.x*uG[7].z-uTime*uG[7].w)));float fresnel=.08+uG[6].w*pow(1.-max(dot(-rd,wn),0.),5.);col=mix(uG[6].rgb,sky(reflect(rd,wn)),fresnel);col+=uG[1].rgb*pow(max(dot(reflect(-sunDirection(),wn),-rd),0.),uG[14].x)*.8;t=waterT;}
 else if(t<uG[15].z){vec3 p=ro+rd*t,n=normalAt(p,t),sun=sunDirection();float diffuse=max(dot(n,sun),0.),shade=shadow(p+n*.04,sun);vec3 light=uG[2].rgb*uG[1].w*(.6+.4*n.y)+uG[1].rgb*uG[0].w*diffuse*shade;col=material(p,hit.y,n)*light;}
 col=mix(col,uG[3].rgb,(1.-exp(-min(t,uG[15].z)*uG[2].w))*uG[3].w);
 color=vec4(pow(max(col*uG[14].y,vec3(0)),vec3(uG[14].z)),1.);
}
