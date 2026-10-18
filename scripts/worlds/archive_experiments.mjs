import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { collectExperiments } from '../../server/world-experiments.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const credentials=JSON.parse(await readFile(repo+'.runtime/migration/r2-credentials.json','utf8'));
const setting=name=>process.env['ARTWORK_R2_'+name]||credentials['R2_'+name];
const client=new S3Client({region:'auto',endpoint:setting('ENDPOINT'),forcePathStyle:true,credentials:{accessKeyId:setting('ACCESS_KEY_ID'),secretAccessKey:setting('SECRET_ACCESS_KEY')},maxAttempts:3});
const bucket=setting('BUCKET'),prefix='artwork-comparison/world-experiments/draa-valley/';
const sha=body=>createHash('sha256').update(body).digest('hex');
const data=await collectExperiments();
const objects=[];
for(const [digest,file] of data.images)objects.push({key:prefix+'images/'+digest+'.png',body:await readFile(repo+'.runtime/worlds/'+file),type:'image/png'});
for(const [digest,body] of data.recipes)objects.push({key:prefix+'recipes/'+digest+'.json',body:Buffer.from(body),type:'application/json'});
for(const name of ['scene.vert','scene.frag','parameters.json','source.json','analysis.json']){const body=await readFile(repo+'public/worlds/draa-valley/'+name);objects.push({key:prefix+'sources/'+sha(body)+'-'+name,body,type:'application/octet-stream'});}
let cursor=0,verified=0;
async function store(object){
 const digest=sha(object.body);
 await client.send(new PutObjectCommand({Bucket:bucket,Key:object.key,Body:object.body,ContentType:object.type,Metadata:{sha256:digest}}));
 const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:object.key}));const bytes=Buffer.from(await response.Body.transformToByteArray());
 if(sha(bytes)!==digest||bytes.length!==object.body.length)throw new Error('Archive integrity mismatch');verified++;
}
await Promise.all(Array.from({length:4},async()=>{while(cursor<objects.length)await store(objects[cursor++]);}));
const manifest={schema:1,createdAt:new Date().toISOString(),prefix,experiments:data.experiments,objects:objects.map(object=>({key:object.key,sha256:sha(object.body),bytes:object.body.length})),scope:'Immutable experimental renders and parameter recipes; generation archive/index untouched'};
const body=Buffer.from(JSON.stringify(manifest));const key=prefix+'manifests/'+sha(body)+'.json';await store({key,body,type:'application/json'});
await mkdir(repo+'.runtime/worlds/experiments',{recursive:true});await writeFile(repo+'.runtime/worlds/experiments/archive-proof.json',JSON.stringify({key,objectsVerified:verified,manifestSha256:sha(body)},null,2));
console.log(JSON.stringify({archivedExperiments:data.experiments.length,objectsVerified:verified,manifestKey:key}));
