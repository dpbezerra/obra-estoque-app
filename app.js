const API_URL = 'https://script.google.com/macros/s/AKfycbyJ-6pGpbsIfZTHuMSz-PgezoziZSYZjCy5Nsd5MYHU1wn941915PnT2C92Vb2It1R8/exec';
const CHAVE = 'obra123teste';

const db = new Dexie("ObraEstoqueDB");
db.version(1).stores({
    filaSync: '++id,data',
    materiaisCache: 'codigo',
    historicoLocal: '++id,data'
});

let materialAtual = null;
let obrasMap = {};
let salvando = false;

window.onload = async function(){
    atualizarStatusConexao();
    await carregarObras();
    await carregarMateriais();
    await carregarHistorico();

    window.addEventListener('online', sincronizarPendentes);
    setInterval(atualizarStatusConexao,3000);
};

function atualizarStatusConexao(){
    document.getElementById("statusConexao").innerText = navigator.onLine ? "🟢 Online" : "🔴 Offline";
}

async function carregarObras(){
    try{
        let resp = await fetch(`${API_URL}?chave=${CHAVE}&action=obras`);
        let obras = await resp.json();

        let select = document.getElementById("obraSelect");
        select.innerHTML = "";

        obras.forEach(o=>{
            obrasMap[o[0]] = o[1];

            let op = document.createElement("option");
            op.value = o[0];
            op.textContent = o[1];
            select.appendChild(op);
        });

    }catch(e){
        alert("Erro ao carregar obras");
    }
}

async function carregarMateriais(){
    try{
        let resp = await fetch(`${API_URL}?chave=${CHAVE}&action=insumos`);
        let mats = await resp.json();

        await db.materiaisCache.clear();

        for(let m of mats){
            await db.materiaisCache.put({
                codigo:String(m[0]),
                descricao:String(m[1]),
                categoria:String(m[2] || ''),
                unidade:String(m[3] || '')
            });
        }

    }catch(e){
        console.log("Materiais carregados do cache local");
    }
}

document.getElementById("buscaMaterial").addEventListener("keyup", async function(){
    let termo = this.value.toLowerCase().trim();
    let resultado = document.getElementById("resultadoBusca");

    if(termo.length < 1){
        resultado.innerHTML = "";
        return;
    }

    let todos = await db.materiaisCache.toArray();

    let filtrados = todos.filter(m =>
        m.codigo.toLowerCase().includes(termo) ||
        m.descricao.toLowerCase().includes(termo)
    ).slice(0,15);

    resultado.innerHTML = "";

    filtrados.forEach(m=>{
        const div = document.createElement("div");
        div.className = "itemBusca";
        div.textContent = `${m.codigo} - ${m.descricao} (${m.unidade})`;

        div.addEventListener("click", function(){
            selecionarMaterial(m.codigo, m.descricao, m.unidade);
        });

        resultado.appendChild(div);
    });
});

function selecionarMaterial(cod,desc,un){
    materialAtual = {codigo:cod, descricao:desc, unidade:un};

    document.getElementById("materialSelecionado").innerText = `${cod} - ${desc} (${un})`;
    document.getElementById("formMovimentacao").style.display = "block";
    document.getElementById("resultadoBusca").innerHTML = "";
    document.getElementById("buscaMaterial").value = "";
}

async function salvarMovimentacao(){
    if(salvando) return;

    if(!materialAtual){
        alert("Selecione um material");
        return;
    }

    let quantidade = document.getElementById("quantidade").value;

    if(!quantidade || Number(quantidade) <= 0){
        alert("Informe a quantidade");
        return;
    }

    salvando = true;

    let mov = {
        chave: CHAVE,
        id_obra: document.getElementById("obraSelect").value,
        nome_obra: obrasMap[document.getElementById("obraSelect").value] || '',
        cod_insumo: materialAtual.codigo,
        desc_insumo: materialAtual.descricao,
        tipo: document.getElementById("tipoMov").value,
        quantidade: quantidade,
        preco_unit: document.getElementById("preco").value || 0,
        obs: document.getElementById("obs").value || ''
    };

    if(navigator.onLine){
        try{
            await fetch(API_URL,{
                method:"POST",
                body:JSON.stringify(mov)
            });

            await db.historicoLocal.add({
                ...mov,
                data:new Date().toLocaleString()
            });

            alert("Movimentação salva com sucesso");
        }catch(e){
            await db.filaSync.add({...mov,data:new Date().toLocaleString()});
            alert("Internet instável. Ficou pendente para sincronizar.");
        }
    }else{
        await db.filaSync.add({...mov,data:new Date().toLocaleString()});
        alert("Offline. Movimentação guardada.");
    }

    salvando = false;
    limparFormulario();
    await carregarHistorico();
}

async function sincronizarPendentes(){
    let pendentes = await db.filaSync.toArray();

    for(let p of pendentes){
        try{
            await fetch(API_URL,{
                method:"POST",
                body:JSON.stringify(p)
            });

            await db.historicoLocal.add(p);
            await db.filaSync.delete(p.id);

        }catch(e){
            console.log("Ainda existem pendências");
        }
    }

    await carregarHistorico();
}

async function carregarHistorico(){
    let hist = await db.historicoLocal.orderBy('id').reverse().limit(20).toArray();

    let html = "";

    hist.forEach(h=>{
        html += `<div class="cardHistorico">
                    <b>${h.data}</b><br>
                    Obra: ${h.nome_obra || h.id_obra}<br>
                    Material: ${h.cod_insumo} - ${h.desc_insumo || ''}<br>
                    Tipo: ${h.tipo == 'E' ? 'Entrada' : 'Saída'}<br>
                    Quantidade: ${h.quantidade}<br>
                    Preço: R$ ${h.preco_unit}<br>
                    Obs: ${h.obs || '-'}
                </div>`;
    });

    document.getElementById("historico").innerHTML = html;
}

function limparFormulario(){
    materialAtual = null;
    document.getElementById("materialSelecionado").innerText = "";
    document.getElementById("quantidade").value = "";
    document.getElementById("preco").value = "";
    document.getElementById("obs").value = "";
    document.getElementById("formMovimentacao").style.display = "none";
}
