import { connect, playFixture } from "./net"; import { ViewerStore } from "./store";
const store = new ViewerStore(), app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<style>body{margin:0;background:#172218;color:#eee;font:14px system-ui}#ground{height:100vh;position:relative;background:radial-gradient(#607b45,#25351f)}.agent{position:absolute;width:16px;height:16px;border-radius:50%;background:#f6d365;transform:translate(-50%,-50%)}label{position:fixed;top:12px;left:12px}</style><label>AI World viewer</label><div id="ground"></div>`;
const ground = document.querySelector<HTMLDivElement>("#ground")!;
function draw() { for (const [id] of store.agents) { const p = store.position(id); if (!p) continue; let el = document.getElementById(id); if (!el) { el = document.createElement("div"); el.id=id; el.className="agent"; ground.append(el); } el.style.left=`${50+p.x/4}%`; el.style.top=`${50+p.z/4}%`; } requestAnimationFrame(draw); } draw();
const fixture = new URLSearchParams(location.search).get("fixture"); if (fixture) playFixture(fixture, (m) => store.apply(m)); else connect(`ws://${location.host}`, (m) => store.apply(m));
