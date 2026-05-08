const API_URL = 'https://script.google.com/macros/s/AKfycbyJ-6pGpbsIfZTHuMSz-PgezoziZSYZjCy5Nsd5MYHU1wn941915PnT2C92Vb2It1R8/exec';
const CHAVE = 'obra123teste';

const db = new Dexie("ObraEstoqueDB");

db.version(2).stores({
    filaSync: '++id,data',
    materiaisCache: 'codigo',
    obrasCache: 'id',
    historicoLocal: '++id,data'
});

let materialAtual = null;

window.onload = async function () {

    atualizarStatusConexao();

    window.addEventListener('online', async () => {
        atualizarStatusConexao();
        await sincronizarPendentes();
    });

    window.addEventListener('offline', atualizarStatusConexao);

    await carregarObras();
    await carregarMateriais();
    await carregarHistorico();

    configurarBusca();

    setInterval(atualizarStatusConexao, 3000);

};

function atualizarStatusConexao() {

    document.getElementById("statusConexao").innerText =
        navigator.onLine ? "🟢 Online" : "🔴 Offline";

}

async function carregarObras() {

    const select = document.getElementById("obraSelect");

    try {

        // PRIMEIRO CARREGA CACHE
        const cache = await db.obrasCache.toArray();

        if (cache.length > 0) {

            select.innerHTML = "";

            cache.forEach(o => {

                let op = document.createElement("option");
                op.value = o.id;
                op.textContent = o.nome;

                select.appendChild(op);

            });

        }

        // DEPOIS ATUALIZA ONLINE
        if (navigator.onLine) {

            let resp = await fetch(`${API_URL}?chave=${CHAVE}&action=obras`);

            let obras = await resp.json();

            select.innerHTML = "";

            await db.obrasCache.clear();

            for (let o of obras) {

                await db.obrasCache.put({
                    id: o[0],
                    nome: o[1],
                    codigo: o[2]
                });

                let op = document.createElement("option");

                op.value = o[0];
                op.textContent = o[1];

                select.appendChild(op);

            }

        }

    } catch (e) {

        console.log("Erro ao carregar obras", e);

    }

}

async function carregarMateriais() {

    try {

        if (navigator.onLine) {

            let resp = await fetch(`${API_URL}?chave=${CHAVE}&action=insumos`);

            let mats = await resp.json();

            await db.materiaisCache.clear();

            for (let m of mats) {

                await db.materiaisCache.put({
                    codigo: String(m[0]),
                    descricao: String(m[1]),
                    categoria: String(m[2]),
                    unidade: String(m[3])
                });

            }

        }

    } catch (e) {

        console.log("Usando materiais do cache");

    }

}

function configurarBusca() {

    const busca = document.getElementById("buscaMaterial");

    busca.addEventListener("keyup", async function () {

        let termo = busca.value.toLowerCase().trim();

        const resultado = document.getElementById("resultadoBusca");

        if (termo.length < 1) {

            resultado.innerHTML = "";
            return;

        }

        let todos = await db.materiaisCache.toArray();

        let filtrados = todos.filter(m => {

            return (
                m.codigo.toLowerCase().includes(termo) ||
                m.descricao.toLowerCase().includes(termo)
            );

        }).slice(0, 15);

        resultado.innerHTML = "";

        filtrados.forEach(m => {

            let item = document.createElement("div");

            item.className = "itemBusca";

            item.innerHTML =
                `<strong>${m.codigo}</strong> - ${m.descricao} (${m.unidade})`;

            item.addEventListener("click", () => {

                selecionarMaterial(
                    m.codigo,
                    m.descricao,
                    m.unidade
                );

            });

            resultado.appendChild(item);

        });

    });

}

function selecionarMaterial(cod, desc, un) {

    materialAtual = {
        codigo: cod,
        descricao: desc,
        unidade: un
    };

    document.getElementById("materialSelecionado").innerText =
        `${cod} - ${desc} (${un})`;

    document.getElementById("formMovimentacao").style.display = "block";

    document.getElementById("resultadoBusca").innerHTML = "";

    document.getElementById("buscaMaterial").value = desc;

}

async function salvarMovimentacao() {

    if (!materialAtual) {

        alert("Selecione um material");
        return;

    }

    let mov = {

        chave: CHAVE,

        id_obra: document.getElementById("obraSelect").value,

        cod_insumo: materialAtual.codigo,

        tipo: document.getElementById("tipoMov").value,

        quantidade: document.getElementById("quantidade").value,

        preco_unit: document.getElementById("preco").value,

        obs: document.getElementById("obs").value,

        data: new Date().toLocaleString()

    };

    // SALVA SEMPRE NO HISTÓRICO LOCAL
    await db.historicoLocal.add(mov);

    if (navigator.onLine) {

        try {

            const resp = await fetch(API_URL, {

                method: "POST",

                body: JSON.stringify(mov)

            });

            const result = await resp.json();

            if (!result.sucesso) {

                throw new Error("Falha servidor");

            }

            alert("✅ Movimentação salva");

        } catch (e) {

            await db.filaSync.add(mov);

            alert("📡 Internet instável. Ficou pendente.");

        }

    } else {

        await db.filaSync.add(mov);

        alert("📴 Offline. Movimentação guardada.");

    }

    limparFormulario();

    await carregarHistorico();

}

async function sincronizarPendentes() {

    let pendentes = await db.filaSync.toArray();

    if (pendentes.length === 0) return;

    for (let p of pendentes) {

        try {

            const resp = await fetch(API_URL, {

                method: "POST",

                body: JSON.stringify(p)

            });

            const result = await resp.json();

            if (result.sucesso) {

                await db.filaSync.delete(p.id);

            }

        } catch (e) {

            console.log("Ainda sem sincronizar");

            break;

        }

    }

}

async function carregarHistorico() {

    let hist = await db.historicoLocal
        .orderBy('id')
        .reverse()
        .limit(20)
        .toArray();

    let html = "";

    hist.forEach(h => {

        html += `

        <div class="cardHistorico">

            <b>${h.data}</b><br>

            🏗️ Obra: ${h.id_obra}<br>

            📦 Material: ${h.cod_insumo}<br>

            🔄 Tipo: ${h.tipo === 'E' ? 'Entrada' : 'Saída'}<br>

            🔢 Quantidade: ${h.quantidade}<br>

            💰 Preço: R$ ${h.preco_unit || 0}<br>

            📝 Obs: ${h.obs || '-'}

        </div>

        `;

    });

    document.getElementById("historico").innerHTML = html;

}

function limparFormulario() {

    document.getElementById("quantidade").value = "";

    document.getElementById("preco").value = "";

    document.getElementById("obs").value = "";

    document.getElementById("formMovimentacao").style.display = "none";

    materialAtual = null;

}
