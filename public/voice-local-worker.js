const runtimeURL="/voice-assets/transformers.min.js";
const runtime = import(runtimeURL).then(({env,pipeline})=>{
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/voice-assets/";
  env.backends.onnx.wasm.wasmPaths = "/voice-assets/";
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  return pipeline;
});

const profiles = {
  tiny: {model:"whisper-tiny",dtype:"q8"},
  base: {model:"whisper-base",dtype:"q8"},
  small: {model:"whisper-small",dtype:"q4"},
};
let model, activeProfile, pendingLoad;
let working = false;

async function loadModel(profile) {
  if (activeProfile===profile && model) return model;
  if (model) await model.dispose();
  model = undefined;
  activeProfile = undefined;
  const pipeline = await runtime;
  const selected = profiles[profile];
  model = await pipeline("automatic-speech-recognition",selected.model,{
    device:"wasm",dtype:selected.dtype,
    progress_callback:({status,name,progress})=>{
      if (status==="progress" && Number.isFinite(progress)) self.postMessage({stage:"load",progress:Math.floor(progress),name,profile});
    },
  });
  activeProfile = profile;
  return model;
}

function useModel(profile) {
  if (pendingLoad?.profile===profile) return pendingLoad.promise;
  const previous=pendingLoad?.promise.catch(()=>{}) ?? Promise.resolve();
  const promise=previous.then(()=>loadModel(profile));
  const request={profile,promise};
  pendingLoad=request;
  const done=()=>{if (pendingLoad===request) pendingLoad=undefined;};
  void promise.then(done,done);
  return promise;
}

self.onmessage = async ({data}) => {
  const {samples,profile,prepare} = data ?? {};
  if (working || !Object.hasOwn(profiles,profile)) return;
  if (prepare) {void useModel(profile).catch(()=>{});return;}
  if (!(samples instanceof Float32Array) || samples.length<1600 || samples.length>480000) return;
  working = true;
  try {
    const transcribe = await useModel(profile);
    self.postMessage({stage:"transcribe",profile});
    const started = performance.now();
    const result = await transcribe(samples,{language:"turkish",task:"transcribe",do_sample:false,max_new_tokens:180});
    self.postMessage({text:String(result.text || "").trim(),profile,decodeMs:Math.round(performance.now()-started)});
  } catch (error) {
    console.error("VetZimo Voice",error);
    if (model) await model.dispose().catch(()=>{});
    model = undefined;
    activeProfile = undefined;
    self.postMessage({error:true,profile});
  } finally {
    working = false;
  }
};
