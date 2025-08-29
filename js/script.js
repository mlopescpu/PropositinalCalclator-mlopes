const exprInput = document.getElementById("expr");
const btnCalc   = document.getElementById("btn-calc");
const fmtBtn    = document.getElementById("fmt-toggle");
const tableWrap = document.getElementById("table-wrap");
const tableContainer = document.getElementById("table-container");
const metaEl    = document.getElementById("meta");

// formato atual: "vf" (padrão) ou "01"
let formatMode = "vf";

// Inserção via botões do teclado
document.querySelectorAll(".keypad [data-ins]").forEach(btn=>{
  btn.addEventListener("click", ()=> insert(btn.dataset.ins));
});

// Ações (C e ⌫)
document.querySelectorAll(".keypad [data-cmd]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const cmd = btn.dataset.cmd;
    if (cmd === "clear") exprInput.value = "";
    if (cmd === "del")   exprInput.value = exprInput.value.slice(0, -1);
    exprInput.focus();
  });
});

// Toggle de formato V/F ↔ 0/1
fmtBtn.addEventListener("click", ()=>{
  formatMode = (formatMode === "vf") ? "01" : "vf";
  fmtBtn.innerHTML = `Formato: <b>${formatMode === "vf" ? "V/F" : "0/1"}</b>`;
  if (!tableWrap.classList.contains("hidden") && lastData) renderTable(lastData);
});

// Enter calcula
exprInput.addEventListener("keydown",(e)=>{ if (e.key === "Enter") calc(); });
btnCalc.addEventListener("click", calc);

// util do input
function insert(text){
  const start = exprInput.selectionStart ?? exprInput.value.length;
  const end   = exprInput.selectionEnd ?? exprInput.value.length;
  const v = exprInput.value;
  exprInput.value = v.slice(0,start) + text + v.slice(end);
  const pos = start + text.length;
  exprInput.setSelectionRange(pos,pos);
  exprInput.focus();
}

let lastData = null;

function calc(){
  const exprRaw = exprInput.value.trim();
  if (!exprRaw) {
    showError("Digite uma fórmula.");
    return;
  }
  try{
    const data = buildTruthTable(exprRaw); // tudo no cliente
    lastData = data;
    renderTable(data);
  }catch(err){
    showError(err.message || "Erro ao avaliar expressão.");
  }
}

function showError(msg){
  tableWrap.classList.remove("hidden");
  metaEl.innerHTML = `<span style="color:#ff9a9a;font-weight:700">Erro:</span> ${escapeHtml(msg)}`;
  tableContainer.innerHTML = "";
}

function fmt(bit){
  if (formatMode === "vf") return bit ? "V" : "F";
  return bit ? "1" : "0";
}

function renderTable(data){
  const vars = data.vars || [];
  const rows = data.rows || [];
  tableWrap.classList.remove("hidden");
  metaEl.textContent = `Fórmula: ${data.expr}  •  Linhas: ${rows.length}  •  Formato: ${formatMode === "vf" ? "V/F" : "0/1"}`;

  const headers = [...vars, "Resultado"];
  let html = `<table class="truth-table"><thead><tr>`;
  for (const h of headers) html += `<th>${escapeHtml(h)}</th>`;
  html += `</tr></thead><tbody>`;

  for (const row of rows){
    html += `<tr>`;
    for (let i=0;i<vars.length;i++){
      const v = row[i] ?? 0;
      html += `<td>${fmt(v === 1)}</td>`;
    }
    const res = row[vars.length] ?? 0;
    html += `<td class="res-${res}">${fmt(res === 1)}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  tableContainer.innerHTML = html;
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

/* =================== LÓGICA / PARSER 100% JS =================== */

// Constrói a tabela-verdade a partir da expressão digitada
function buildTruthTable(exprRaw){
  const norm = normalize(exprRaw);
  const varsLower = extractVars(norm);           // ['a','b',...]
  const varsUpper = varsLower.map(c => c.toUpperCase());
  const evalFn = compile(norm);                  // (ctx) => boolean

  const rows = [];
  const n = varsLower.length;
  if (n === 0){
    rows.push([ evalFn({}) ? 1 : 0 ]);
  } else {
    const total = 1 << n;
    for (let mask=0; mask<total; mask++){
      const ctx = {};
      const row = new Array(n+1);
      for (let i=0;i<n;i++){
        const bit = ((mask >> (n-1-i)) & 1) === 1;
        ctx[varsLower[i]] = bit;
        row[i] = bit ? 1 : 0;
      }
      row[n] = evalFn(ctx) ? 1 : 0;
      rows.push(row);
    }
  }
  return { ok:true, expr: exprRaw, vars: varsUpper, rows };
}

// Normaliza símbolos e espaços
function normalize(s){
  return s
    .replace(/\s+/g, "")
    .replace(/¬|~/g, "!")
    .replace(/∧/g, "&")
    .replace(/∨/g, "|")
    .replace(/→/g, "->")
    .replace(/↔/g, "<->")
    .toLowerCase();
}

// Extrai variáveis usadas (a–d), em ordem alfabética, sem repetição
function extractVars(s){
  const set = new Set();
  for (const ch of s){
    if (ch >= 'a' && ch <= 'd') set.add(ch);
  }
  return Array.from(set).sort();
}

// Compila a expressão para uma função (ctx) => boolean
function compile(s){
  const P = new Parser(s);
  const fn = P.parse();
  if (!P.end()) throw new Error("Símbolos restantes após o fim da expressão.");
  return fn;
}

// Parser descendente recursivo com precedência:
//  IFF <->  IMPLIES ->  OR |  AND &  NOT !  PRIMARY
class Parser{
  constructor(s){ this.s=s; this.i=0; }
  end(){ return this.i >= this.s.length; }
  peek(){ return this.s[this.i]; }
  eat(ch){ if(!this.end() && this.s[this.i]===ch){ this.i++; return true; } return false; }
  startsWith(w){ return this.s.slice(this.i, this.i+w.length) === w; }
  match(w){ if (this.startsWith(w)){ this.i += w.length; return true; } return false; }

  parse(){ return this.parseIff(); }

  parseIff(){
    let left = this.parseImplies();
    while (this.match("<->")){
      const L = left, R = this.parseImplies();
      left = (ctx) => L(ctx) === R(ctx);
    }
    return left;
  }
  parseImplies(){
    let left = this.parseOr();
    while (this.match("->")){
      const L = left, R = this.parseOr();
      left = (ctx) => (!L(ctx)) || R(ctx);
    }
    return left;
  }
  parseOr(){
    let left = this.parseAnd();
    while (this.eat('|')){
      const L = left, R = this.parseAnd();
      left = (ctx) => L(ctx) || R(ctx);
    }
    return left;
  }
  parseAnd(){
    let left = this.parseNot();
    while (this.eat('&')){
      const L = left, R = this.parseNot();
      left = (ctx) => L(ctx) && R(ctx);
    }
    return left;
  }
  parseNot(){
    if (this.eat('!')){
      const F = this.parseNot();
      return (ctx) => !F(ctx);
    }
    return this.parsePrimary();
  }
  parsePrimary(){
    if (this.eat('(')){
      const inside = this.parseIff();
      if (!this.eat(')')) throw new Error("Esperava ')'.");
      return inside;
    }
    if (this.end()) throw new Error("Fim inesperado.");

    const c = this.peek();
    if (c>='a' && c<='d'){ this.i++; const k=c; return (ctx)=> !!ctx[k]; }
    if (this.startsWith("true"))  { this.i+=4; return ()=> true; }
    if (this.startsWith("false")) { this.i+=5; return ()=> false; }

    throw new Error(`Token inválido perto de '${c}'. Use A–D, !, &, |, ->, <->, parênteses.`);
  }
}
