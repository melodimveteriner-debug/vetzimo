"use strict";

const SCALE = 1000000;
const SNAP_LIMIT_METERS = 120;
let manifest;
const tiles=new Map();
const TURKEY=[35.8,25.5,42.2,45];

class MinHeap {
  #entries = [];
  push(edge, cost) {
    const entry = {edge, cost}, heap = this.#entries;
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].cost <= cost) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  }
  pop() {
    const heap = this.#entries;
    if (!heap.length) return null;
    const first = heap[0], last = heap.pop();
    if (!heap.length) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
      if (heap[child].cost >= last.cost) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  }
}

async function binaryTile(url) {
  const response=await fetch(url);
  if (!response.ok) throw new Error("Bölgenin yol dosyası yüklenemedi.");
  const bytes=await response.arrayBuffer();
  const header=new Uint8Array(bytes,0,2);
  const stream=new Blob([bytes]).stream();
  const decoded=header[0]===31&&header[1]===139?stream.pipeThrough(new DecompressionStream("gzip")):stream;
  return new Uint8Array(await new Response(decoded).arrayBuffer());
}

function inTurkey(point) {
  return point && Number.isFinite(point.lat)&&Number.isFinite(point.lon)&&
    point.lat>=TURKEY[0]&&point.lat<=TURKEY[2]&&point.lon>=TURKEY[1]&&point.lon<=TURKEY[3];
}

async function loadGraph(points) {
  if (!Array.isArray(points)||points.length<2||points.length>16) throw new Error("En fazla 15 ziyaret planlanabilir.");
  if (!inTurkey(points[0])) throw new Error("Türkiye sınırları içinde başlangıç konumu seçin.");
  const valid=points.filter(inTurkey);
  const latitudes=valid.map(p=>p.lat),longitudes=valid.map(p=>p.lon);
  const pad=.075;
  const minLat=Math.min(...latitudes)-pad,maxLat=Math.max(...latitudes)+pad;
  const minLon=Math.min(...longitudes)-pad,maxLon=Math.max(...longitudes)+pad;
  const south=Math.floor(minLat*2),north=Math.floor(maxLat*2),west=Math.floor(minLon*2),east=Math.floor(maxLon*2);
  if ((north-south+1)*(east-west+1)>12) throw new Error("Ziyaretler geniş bir alana yayılıyor. İl veya bölgeye göre filtreleyip ayrı rota oluşturun.");
  manifest??=fetch("./visit-road-data/manifest.json?v=49").then(response=>{
    if (!response.ok) throw new Error("Türkiye yol verisi sunucuda bulunamadı.");
    return response.json();
  }).catch(error=>{manifest=null;throw error;});
  const metadata=await manifest;
  if (metadata.version!==2) throw new Error("Yol verisi sürümü uyumsuz.");
  const available=new Set(metadata.tiles),needed=[];
  for (let i=south;i<=north;i++) for (let j=west;j<=east;j++) {
    const id=i+"_"+j;
    if (available.has(id)) needed.push(id);
  }
  for (const id of tiles.keys()) if(!needed.includes(id)) tiles.delete(id);
  const parts=await Promise.all(needed.map(id=>{
    if (!tiles.has(id)) tiles.set(id,binaryTile("./visit-road-data/"+id+".gz?v=49")
      .catch(error=>{tiles.delete(id);throw error;}));
    return tiles.get(id);
  }));
  const nodes=[],edges=[],indices=new Map(),segments=new Set(),barrierIds=new Set();
  const index=(key,lat,lon)=>{
    if (!indices.has(key)) {
      indices.set(key,nodes.length);
      nodes.push([lat,lon]);
    }
    return indices.get(key);
  };
  for (const part of parts) {
    let offset=0,way=0,node=0,lat=0,lon=0;
    const unsigned=()=>{
      let value=0,base=1;
      for(let i=0;i<8&&offset<part.length;i++){
        const byte=part[offset++];
        value+=(byte&127)*base;
        if(byte<128) return value;
        base*=128;
      }
      throw new Error("Yol dosyası eksik veya bozuk.");
    };
    const zigzag=value=>value%2===0?value/2:-(value+1)/2;
    const signed=()=>zigzag(unsigned());
    while(offset<part.length){
      const lead=unsigned();
      if(!lead){barrierIds.add(unsigned());continue;}
      way+=zigzag(lead-1);
      const sequence=unsigned();
      const a=[node+signed(),lat+signed(),lon+signed()];
      const b=[a[0]+signed(),a[1]+signed(),a[2]+signed()];
      [node,lat,lon]=b;
      const speed=unsigned(),flags=unsigned(),major=Math.floor(flags/3),direction=flags%3-1;
      if(Math.max(a[1],b[1])<minLat*SCALE||Math.min(a[1],b[1])>maxLat*SCALE||
        Math.max(a[2],b[2])<minLon*SCALE||Math.min(a[2],b[2])>maxLon*SCALE) continue;
      const key=way+"/"+sequence;
      if (segments.has(key)) continue;
      segments.add(key);
      const dx=(b[2]-a[2])*Math.cos((a[1]+b[1])*Math.PI/360000000);
      const length=Math.hypot(b[1]-a[1],dx)*111195/SCALE;
      const count=Math.max(1,Math.ceil(length/65));
      let previous=index(...a);
      for(let step=1;step<=count;step++){
        const to=step===count?index(...b):index(key+"/"+step,
          Math.round(a[1]+(b[1]-a[1])*step/count),Math.round(a[2]+(b[2]-a[2])*step/count));
        const meters=Math.max(1,Math.round(length/count));
        if(direction>=0) edges.push([previous,to,meters,speed,way,major]);
        if(direction<=0) edges.push([to,previous,meters,speed,way,major]);
        previous=to;
      }
    }
  }
  const turns=metadata.turns.filter(([node])=>indices.has(node)).map(([node,a,b,kind])=>[indices.get(node),a,b,kind,[]]);
  const barriers=[...barrierIds].filter(id=>indices.has(id)).map(id=>indices.get(id));
  return prepareGraph({version:1,date:metadata.date,bounds:TURKEY,nodes,edges,turns,barriers});
}

function prepareGraph(graph) {
  if (graph.version !== 1) throw new Error("Yol verisi sürümü uyumsuz.");
  const outgoing = Array.from({length: graph.nodes.length}, () => []);
  const incoming = new Uint8Array(graph.nodes.length);
  const restrictions = new Map(), barriers = new Set(graph.barriers);
  graph.edges.forEach(([from,to], index) => {
    outgoing[from].push(index);
    incoming[to] = 1;
  });
  const addRule = (node, from, to, kind) => {
    if (!restrictions.has(node)) restrictions.set(node,new Map());
    const fromWays = restrictions.get(node);
    if (!fromWays.has(from)) fromWays.set(from,[]);
    fromWays.get(from).push({to,kind});
  };
  for (const [node,from,to,kind,via] of graph.turns) {
    if (node >= 0) {
      addRule(node,from,to,kind);
      continue;
    }
    // For via-way prohibitions exclude both entrances from the restricted approach.
    // This is conservative and can choose a detour even if a later turn were allowed.
    const entrances = new Set(graph.edges.filter(edge => edge[4] === from).map(edge => edge[1]));
    for (const entrance of entrances) {
      if (!outgoing[entrance].some(index => graph.edges[index][4] === via[0])) continue;
      addRule(entrance,from,via[0],kind.startsWith("no_")?"no_via_entry":kind);
      if (kind.startsWith("only_")) {
        for (let i=0;i<via.length;i++) {
          const next = via[i+1] ?? to;
          for (const edge of graph.edges) {
            if (edge[4] === via[i] && outgoing[edge[1]].some(index => graph.edges[index][4] === next)) {
              addRule(edge[1],via[i],next,kind);
            }
          }
        }
      }
    }
  }
  return {...graph,outgoing,incoming,restrictions,barriers};
}

function snap(graph, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const [south,west,north,east] = graph.bounds;
  if (point.lat<south || point.lat>north || point.lon<west || point.lon>east) return null;
  const scale = 111195 / SCALE;
  const longitudeScale = scale * Math.cos(point.lat * Math.PI / 180);
  let best = SNAP_LIMIT_METERS ** 2, result = null;
  for (let index=0;index<graph.nodes.length;index++) {
    if (!graph.outgoing[index].length || !graph.incoming[index] || graph.barriers.has(index)) continue;
    const [lat,lon] = graph.nodes[index];
    const square = ((point.lat*SCALE-lat)*scale)**2 + ((point.lon*SCALE-lon)*longitudeScale)**2;
    if (square < best) {
      best=square;
      result=index;
    }
  }
  return result;
}

function allowed(graph,next,previous) {
  const [before,node,,,fromWay] = previous;
  const [,after,,,toWay] = next;
  if (graph.barriers.has(node)) return false;
  const rules = graph.restrictions.get(node)?.get(fromWay);
  if (!rules) return true;
  let only = false, matches = false;
  for (const {to,kind} of rules) {
    const uTurn = kind.endsWith("_u_turn");
    const applies = toWay === to && (uTurn ? before === after : fromWay !== toWay || before !== after);
    if (kind.startsWith("only_")) {
      only = true;
      if (applies) matches = true;
    } else if (applies) return false;
  }
  return !only || matches;
}

function search(graph, source, targets) {
  const result = new Map();
  if (source === null) return result;
  const remaining = new Set(targets.filter(target => target !== null));
  if (remaining.delete(source)) result.set(source,{meters:0,seconds:0,path:[source]});
  if (!remaining.size) return result;
  const {edges,outgoing} = graph;
  const distances = new Float64Array(edges.length).fill(Infinity);
  const seconds = new Float64Array(edges.length);
  const parents = new Int32Array(edges.length).fill(-1);
  const heap = new MinHeap();
  for (const index of outgoing[source]) {
    const [, , meters, speed] = edges[index];
    distances[index] = meters;
    seconds[index] = meters*3.6/speed;
    heap.push(index,meters);
  }
  for (let item; remaining.size && (item=heap.pop());) {
    const {edge,cost} = item;
    if (cost !== distances[edge]) continue;
    const current = edges[edge], node = current[1];
    if (remaining.delete(node)) {
      const path = [];
      for (let cursor=edge;cursor!==-1;cursor=parents[cursor]) path.push(edges[cursor][1]);
      path.push(source);
      result.set(node,{meters:cost,seconds:Math.round(seconds[edge]),path:path.reverse()});
    }
    for (const index of outgoing[node]) {
      if (!allowed(graph,edges[index],current)) continue;
      const [,,meters,speed] = edges[index];
      const distance=cost+meters, duration=seconds[edge]+meters*3.6/speed;
      if (distance>distances[index] || (distance===distances[index] && duration>=seconds[index])) continue;
      distances[index]=distance;
      seconds[index]=duration;
      parents[index]=edge;
      heap.push(index,distance);
    }
  }
  return result;
}

function calculate(graph,points) {
  if (!Array.isArray(points) || points.length<2 || points.length>16) throw new Error("En fazla 15 ziyaret planlanabilir.");
  const snaps = points.map(point => snap(graph,point));
  if (snaps[0] === null) throw new Error("Başlangıç noktası araç yoluna bağlanamadı. Yakındaki bir araç yolu üzerindeki konumu seçin.");
  const targets=snaps.slice(1), results=new Map();
  for (const source of new Set(snaps)) results.set(source,search(graph,source,targets));
  const positions = [], positionIds=new Map();
  const position = index => {
    if (!positionIds.has(index)) {
      positionIds.set(index,positions.length);
      positions.push(graph.nodes[index]);
    }
    return positionIds.get(index);
  };
  const matrix=snaps.map(source=>targets.map(target=>{
    const leg=results.get(source).get(target);
    return leg?{...leg,path:leg.path.map(position)}:null;
  }));
  const roadLines = [];
  let minLat=Infinity,minLon=Infinity,maxLat=-Infinity,maxLon=-Infinity;
  for (const [lat,lon] of positions) {
    minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
    minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon);
  }
  const buffer = Math.max(1200,Math.round(Math.max(maxLat-minLat,maxLon-minLon)*.1));
  const wide = Math.max(maxLat-minLat,maxLon-minLon)>140000;
  const seen = new Set();
  for (const [from,to,,,,major] of graph.edges) {
    if (wide && !major) continue;
    const [lat,lon]=graph.nodes[from], [destLat,destLon]=graph.nodes[to];
    if (Math.max(lat,destLat)<minLat-buffer || Math.min(lat,destLat)>maxLat+buffer ||
        Math.max(lon,destLon)<minLon-buffer || Math.min(lon,destLon)>maxLon+buffer) continue;
    const key=Math.min(from,to)*graph.nodes.length+Math.max(from,to);
    if (seen.has(key)) continue;
    seen.add(key);
    roadLines.push([lat,lon,destLat,destLon,major]);
  }
  return {matrix,positions,roadLines,snaps:snaps.map(id=>id===null?null:graph.nodes[id]),date:graph.date};
}

self.onmessage = async ({data}) => {
  try {
    self.postMessage({request:data.request,...calculate(await loadGraph(data.points),data.points)});
  } catch (error) {
    self.postMessage({request:data.request,error:error.message});
  }
};
