import { readFileSync } from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync("serviceAccountKey.json","utf8"))) });
const db=admin.firestore();
const env=readFileSync(".env","utf8");const pega=(n)=>env.match(new RegExp(`^${n}=(.*)$`,"m"))?.[1]?.replace(/^"|"$/g,"");
const ML="https://api.mercadolibre.com";
const con=(await db.collection("ml_tokens").doc("main").get()).data();
const tk=await fetch(`${ML}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"refresh_token",client_id:pega("ML_APP_ID"),client_secret:pega("ML_SECRET"),refresh_token:con.refresh_token})}).then(r=>r.json()).then(j=>j.access_token);
const h={Authorization:`Bearer ${tk}`,Accept:"application/json"};
const SELLER=con.user_id??con.userId;
const brl=(v)=>"R$ "+v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,".");
const janela=async(desde,rot)=>{
  let off=0,ped=[];
  while(off<6000){
    const r=await fetch(`${ML}/orders/search?seller=${SELLER}&order.date_created.from=${desde}&offset=${off}&limit=50`,{headers:h}).then(x=>x.json());
    const res=r.results??[];ped.push(...res); if(res.length<50)break; off+=50;
  }
  const nc=ped.filter(o=>String(o.status)!=="cancelled");
  const fat=nc.reduce((s,o)=>s+Number(o.total_amount??0),0);
  console.log(`${rot.padEnd(22)} ${String(ped.length).padStart(5)} pedidos · ${String(nc.length).padStart(5)} concluidas · ${brl(fat).padStart(12)}`);
  return {fat,concl:nc.length};
};
console.log("janela                  vendas   concluidas    faturado");
console.log("─".repeat(64));
const d60=await janela("2026-07-03T00:00:00.000-03:00","60 dias (painel)");
const d90=await janela("2026-06-03T00:00:00.000-03:00","90 dias");
const d120=await janela("2026-05-04T00:00:00.000-03:00","120 dias");
console.log("─".repeat(64));
console.log(`painel ML 60d: 937 concluidas · R$ 41.910`);
console.log(`\nGold mostra no seu print: R$ 76.490`);
for(const [rot,v] of [["60d",d60],["90d",d90],["120d",d120]]){
  const p=(v.fat/76490*100);
  console.log(`  se o alvo for sobre ${rot}: ${brl(v.fat)} = ${p.toFixed(0)}% · faltam ${brl(Math.max(0,76490-v.fat))}`);
}
