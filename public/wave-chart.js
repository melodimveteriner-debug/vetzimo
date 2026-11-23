export function waveLine(points) {
  return points.reduce((line,[x,y],i)=>{
    if (!i) return `M${x},${y}`;
    const [lastX,lastY]=points[i-1], bend=(x-lastX)*.42;
    return `${line} C${lastX+bend},${lastY} ${x-bend},${y} ${x},${y}`;
  },"");
}

export function waveChart(points,series,format,esc,{compact=false,edge=false,monthAxis=false,label="",includeZero=true}={}) {
  if (!points.length) return '<p class="chart-empty">Bu dönemde grafiğe yansıyan hareket yok.</p>';
  const width=compact?360:600,height=monthAxis?116:edge?104:compact?151:245;
  const left=edge?0:compact?19:42, right=edge?width:width-(compact?87:118), top=edge?10:20, bottom=monthAxis?height-20:edge?height:height-29;
  const numbers=points.flatMap(row=>series.map((_,i)=>row[i+1])).filter(Number.isFinite);
  if (!numbers.length) return '<p class="chart-empty">Bu dönemde grafiğe yansıyan hareket yok.</p>';
  const low=includeZero?Math.min(0,...numbers):Math.min(...numbers)*.98;
  const high=includeZero?Math.max(1,...numbers):Math.max(low+1,...numbers)*1.02;
  const x=i=>points.length===1?(left+right)/2:left+i*(right-left)/(points.length-1);
  const y=value=>top+(high-value)/(high-low)*(bottom-top);
  const grid=Array.from({length:4},(_,i)=>{
    const row=top+(bottom-top)*i/3;
    return `<path class="wave-grid" d="M${left} ${row}H${right}"/>`;
  }).join("");
  const labelYs=series.map((_,i)=>({i,y:y(points.at(-1)[i+1])})).sort((a,b)=>a.y-b.y);
  labelYs.forEach((point,i)=>{if (i) point.y=Math.max(point.y,labelYs[i-1].y+17);});
  const excess=Math.max(0,labelYs.at(-1).y-bottom);
  const ends=new Map(labelYs.map(({i,y})=>[i,y-excess]));
  const curves=series.map(([,tone],i)=>{
    const coords=points.flatMap((row,index)=>Number.isFinite(row[i+1])?[[x(index),y(row[i+1])]]:[]);
    if (!coords.length) return null;
    const drawn=coords.length>1||monthAxis?coords:[[left,coords[0][1]],[right,coords[0][1]]];
    const line=waveLine(drawn);
    const [endX,endY]=drawn.at(-1);
    const area=line+` L${endX},${bottom} L${drawn[0][0]},${bottom} Z`;
    return {tone,area,line,endX,endY,index:i,single:drawn.length===1};
  }).filter(Boolean);
  const areas=curves.map(({tone,area})=>`<path class="wave-area wave-${tone}" d="${area}"/>`).join("");
  const lines=curves.map(({tone,line,index,single,endX,endY})=>single?`<circle class="wave-dot wave-${tone}" cx="${endX}" cy="${endY}" r="4"/>`:`<path class="wave-line wave-${tone}" style="--wave-stroke:${2.4+2*(series.length-index-1)}px" d="${line}"/>`).join("");
  const markers=edge?"":curves.map(({tone,endX,endY,index:i})=>`<g class="wave-${tone}">
      <circle class="wave-dot" cx="${endX}" cy="${endY}" r="${compact?4:4.5}"/>
      <text class="wave-value" x="${endX+10}" y="${ends.get(i)+4}">${esc(format(points.at(-1)[i+1]))}</text></g>`).join("");
  const half=(right-left)/Math.max(1,points.length-1)/2;
  const zones=points.map((row,i)=>{
    if (!row.slice(1).some(Number.isFinite)) return "";
    const readout=series.flatMap(([name],j)=>Number.isFinite(row[j+1])?[name+" "+format(row[j+1])]:[]).join(" · ");
    const start=i===0?0:x(i)-half, end=i===points.length-1?width:x(i)+half;
    return `<g class="wave-hit" tabindex="0" role="img" aria-label="${esc(row[0]+" · "+readout)}"><title>${esc(row[0]+" · "+readout)}</title>
      <rect x="${start}" y="0" width="${end-start}" height="${edge?height:bottom+5}"/><path d="M${x(i)} ${top}V${bottom}"/>
      ${series.flatMap(([,tone],j)=>Number.isFinite(row[j+1])?[`<circle class="wave-${tone}" cx="${x(i)}" cy="${y(row[j+1])}" r="5"/>`]:[]).join("")}</g>`;
  }).join("");
  const ticks=(monthAxis?[0,7,14,21,points.length-1].filter(i=>i<points.length):points.length>4?[0,Math.floor((points.length-1)/2),points.length-1]:points.map((_,i)=>i)).filter((i,j,all)=>all.indexOf(i)===j);
  return `<div class="wave-chart${compact?" wave-compact":""}${edge?" wave-edge":""}"><svg ${edge?'preserveAspectRatio="none"':""} viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(label||series.map(([name])=>name).join(" ve ")+" eğilimi")}">
    ${grid}<g class="wave-reveal">${areas}${lines}</g>${markers}${zones}
    ${edge&&!monthAxis?"":ticks.map((i,j)=>`<text x="${monthAxis&&j===0?4:monthAxis&&j===ticks.length-1?width-4:x(i)}" y="${height-6}" text-anchor="${j===0&&ticks.length>1?"start":monthAxis&&j===ticks.length-1?"end":"middle"}">${esc(String(points[i][0]).length>24?String(points[i][0]).slice(0,22)+"…":points[i][0])}</text>`).join("")}
    </svg>${compact&&series.length===1?"":`<div class="wave-legend">${series.map(([name,tone])=>`<span class="wave-${tone}">${esc(name)}</span>`).join("")}</div>`}</div>`;
}
