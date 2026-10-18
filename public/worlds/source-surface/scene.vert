#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 aColor;
layout(location=1) in vec4 aDepth;
uniform vec2 uSourceSize;
uniform vec2 uViewport;
uniform vec3 uCamera;
uniform vec2 uLook;
uniform float uRelief;
flat out vec3 pixelColor;
void main(){
 const vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,0),vec2(1,1),vec2(0,1));
 vec2 corner=corners[gl_VertexID];
 vec2 cell=vec2(float(gl_InstanceID%int(uSourceSize.x)),float(gl_InstanceID/int(uSourceSize.x)));
 int index=corner.y<.5?(corner.x<.5?0:1):(corner.x<.5?3:2);
 float depth=2.+uRelief*aDepth[index];
 vec2 uv=(cell+corner)/uSourceSize*2.-1.;uv.y=-uv.y;
 vec3 point=vec3(uv*depth,-depth)-uCamera;
 float cy=cos(uLook.x),sy=sin(uLook.x),cp=cos(uLook.y),sp=sin(uLook.y);
 point=vec3(cy*point.x+sy*point.z,point.y,-sy*point.x+cy*point.z);
 point=vec3(point.x,cp*point.y-sp*point.z,sp*point.y+cp*point.z);
 float aspect=uViewport.x/uViewport.y;
 gl_Position=vec4(point.x/aspect,point.y,-1.002002*point.z-.02002002,-point.z);
 pixelColor=aColor.rgb;
}
