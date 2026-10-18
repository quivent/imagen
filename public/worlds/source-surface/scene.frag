#version 300 es
precision highp float;
flat in vec3 pixelColor;
out vec4 color;
void main(){color=vec4(pixelColor,1.);}
