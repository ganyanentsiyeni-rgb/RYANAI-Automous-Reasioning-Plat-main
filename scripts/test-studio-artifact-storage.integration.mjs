#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createStudioArtifactDownloadUrl, STUDIO_ARTIFACT_BUCKET, storeStudioArtifact } from '../src/server/engineering/studioArtifactStorage.ts';
const required = name => { const value=process.env[name]?.trim(); if(!value) throw new Error(name+' is required for disposable local Supabase tests.'); return value; };
const url=required('SUPABASE_URL'), serviceKey=required('SUPABASE_SERVICE_ROLE_KEY'), anonKey=required('SUPABASE_ANON_KEY');
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const email='studio-storage-'+randomUUID()+'@example.invalid', password=randomUUID()+'Aa1!';
const userResult=await service.auth.admin.createUser({email,password,email_confirm:true});
if(userResult.error || !userResult.data.user) throw new Error('Disposable Auth user creation failed: '+userResult.error?.message);
const ownerId=userResult.data.user.id, otherOwnerId=randomUUID(), projectId=randomUUID(), taskId=randomUUID();
const scoped=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const login=await scoped.auth.signInWithPassword({email,password});
if(login.error || !login.data.session) throw new Error('Disposable Auth login failed: '+login.error?.message);
const bytes=Buffer.from(JSON.stringify({fixture:'studio-artifact-storage',ownerId}));
let keys=[];
try {
 const stored=await storeStudioArtifact({ownerUserId:ownerId,projectId,taskId,filename:'plan.json',bytes,mimeType:'application/json'});
 keys.push(stored.storageKey);
 assert.equal(stored.byteSize,bytes.byteLength); assert.equal(stored.sha256.length,64);
 assert.ok(stored.storageKey.startsWith(ownerId+'/'+projectId+'/'+taskId+'/'));
 const signed=await createStudioArtifactDownloadUrl(stored.storageKey,120);
 assert.ok(signed.signedUrl.startsWith('http')); assert.equal(signed.expiresInSeconds,120);
 const own=await scoped.storage.from(STUDIO_ARTIFACT_BUCKET).download(stored.storageKey);
 assert.ifError(own.error); assert.deepEqual(Buffer.from(await own.data.arrayBuffer()),bytes);
 const ownKey=[ownerId,projectId,taskId,randomUUID()+'-own.json'].join('/');
 const ownUpload=await scoped.storage.from(STUDIO_ARTIFACT_BUCKET).upload(ownKey,bytes,{contentType:'application/json',upsert:false});
 assert.ifError(ownUpload.error); keys.push(ownKey);
 const foreignKey=[otherOwnerId,projectId,taskId,randomUUID()+'-foreign.json'].join('/');
 const foreignUpload=await scoped.storage.from(STUDIO_ARTIFACT_BUCKET).upload(foreignKey,bytes,{contentType:'application/json',upsert:false});
 assert.ok(foreignUpload.error,'owner-scoped storage policy must reject foreign-owner writes');
 console.log('Studio artifact storage integration passed: service upload, signed URL, authenticated owner read/write and foreign-owner write denial.');
} finally {
 if(keys.length) await service.storage.from(STUDIO_ARTIFACT_BUCKET).remove(keys).catch(()=>undefined);
 await service.auth.admin.deleteUser(ownerId).catch(()=>undefined);
}
