const https=require('https'); const fs=require('fs');
const TOKEN='vcp_6BKKu31W4lVfus7ZaDNbtRdq51Wg1CdiMJfMLS0ZgAoBBXC2G90QYpFo';const TEAM='team_divGADHjbNoqurin6oFik847';
const {id}=JSON.parse(fs.readFileSync('/tmp/last_deploy.json','utf8'));
function api(p){return new Promise((res,rej)=>{https.get({host:'api.vercel.com',path:p+'?teamId='+TEAM,headers:{Authorization:'Bearer '+TOKEN}},r=>{let c=[];r.on('data',d=>c.push(d));r.on('end',()=>{try{res(JSON.parse(Buffer.concat(c).toString()))}catch(e){res({})}})}).on('error',rej)})}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const t0=Date.now();while(Date.now()-t0<800000){const d=await api('/v13/deployments/'+id);if(d.readyState==='READY'){console.log('✅ جاهز:',d.url);process.exit(0);}if(d.readyState==='ERROR'){console.log('❌');process.exit(1);}console.log('…',d.readyState||'انتظار');await wait(10000);}})();
