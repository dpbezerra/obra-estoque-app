const API_URL = 'https://script.google.com/macros/s/AKfycbyJ-6pGpbslfZTHuMSz-PgezoziZSYZjCy5Nsd5MYHU1wn941915PnT2C92Vb2lt1R8/exec';
const CHAVE = 'obra123teste';

// Configuração do Banco de Dados Offline (Dexie.js)
const db = new Dexie("ObraEstoqueDB");
db.version(1).stores({
    filaSync: '++id, data',
    materiaisCache: 'codigo',
    obrasCache: 'id',
    historicoLocal: '++id, data'
});

let materialAtual = null;

// ==========================================
// 1. INICIALIZAÇÃO (Tudo em Paralelo)
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    atualizarStatusConexao();
    window.addEventListener('online', atualizarStatusConexao);
    window.addEventListener('offline', atualizarStatusConexao);
    
    // Dispara tudo junto para carregar voando [cite: 58, 59, 60]
    await Promise.all([
        carregarObras(),
        carregarMateriais(),
        carregarHistoricoCompleto()
    ]);

    sincronizarPendentes(); 
});

function atualizarStatusConexao() {
    const statusEl = document.getElementById("statusConexao");
    if (navigator.onLine) {
        statusEl.textContent = "🟢 Online";
        statusEl.style.color = "green";
        sincronizarPendentes();
    } else {
        statusEl.textContent = "🔴 Offline";
        statusEl.style.color = "red";
    }
}

// ==========================================
// 2. CORREÇÃO: CARREGAMENTO DE OBRAS (Stale-While-Revalidate)
// ==========================================
async function carregarObras() {
    // 1. Puxa do cache local primeiro (Instantâneo) [cite: 73, 74, 75]
    const obrasLocais = await db.obrasCache.toArray();
    if (obrasLocais.length > 0) {
        renderizarObras(obrasLocais);
    }

    // 2. Busca online silenciosamente no fundo para manter atualizado [cite: 73, 74, 75]
    if (navigator.onLine) {
        try {
            const res = await fetch(`${API_URL}?chave=${CHAVE}&action=obras`);
            const obras = await res.json();
            
            await db.obrasCache.clear();
            const obrasParaCache = obras.map(o => ({ id: o[0], nome: o[1] }));
            await db.obrasCache.bulkAdd(obrasParaCache);
            
            renderizarObras(obrasParaCache);
        } catch (e) {
            console.log("Erro ao buscar obras online, seguindo com o cache.", e);
        }
    }
}

function renderizarObras(obras) {
    const selectObra = document.getElementById("obraSelect");
    selectObra.innerHTML = "";
    obras.forEach(o => {
        let option = document.createElement("option");
        option.value = o.id;
        option.textContent = o.nome;
        selectObra.appendChild(option);
    });
}

// ==========================================
// CARREGAMENTO DE MATERIAIS
// ==========================================
async function carregarMateriais() {
    if (navigator.onLine) {
        try {
            const res = await fetch(`${API_URL}?chave=${CHAVE}&action=materiais`);
            const mats = await res.json();
            await db.materiaisCache.clear();
            const matsParaCache = mats.map(m => ({
                codigo: String(m[0]),
                descricao: String(m[1]),
                categoria: String(m[2] || ''),
                unidade: String(m[3] || '')
            }));
            await db.materiaisCache.bulkAdd(matsParaCache);
        } catch (e) {
            console.log("Sem internet para atualizar materiais. Usando cache.", e);
        }
    }
}

// ==========================================
// 3. CORREÇÃO: BUSCA DE MATERIAIS (Adeus Bug da Serra 10")
// ==========================================
document.getElementById("buscaMaterial").addEventListener("keyup", async function() {
    let termo = this.value.toLowerCase().trim();
    let divResultado = document.getElementById("resultadoBusca");
    divResultado.innerHTML = "";

    if (termo.length < 2) return;

    let todos = await db.materiaisCache.toArray();
    let filtrados = todos.filter(m => 
        m.descricao.toLowerCase().includes(termo) || 
        m.codigo.toLowerCase().includes(termo)
    ).slice(0, 15);

    filtrados.forEach(m => {
        let div = document.createElement("div");
        div.className = "itemBusca";
        div.style.padding = "10px";
        div.style.borderBottom = "1px solid #ccc";
        div.style.cursor = "pointer";
        
        // Usar textContent impede que aspas quebrem o HTML [cite: 78, 79, 80]
        div.textContent = `${m.codigo} - ${m.descricao} (${m.unidade})`;
        
        // Passar função via closure evita bugs de caracteres especiais no onclick [cite: 78, 79, 80]
        div.onclick = () => selecionarMaterial(m.codigo, m.descricao);
        
        divResultado.appendChild(div);
    });
});

function selecionarMaterial(codigo, descricao) {
    materialAtual = { codigo, descricao };
    document.getElementById("buscaMaterial").value = "";
    document.getElementById("resultadoBusca").innerHTML = "";
    document.getElementById("formMovimentacao").style.display = "block";
    
    document.getElementById("materialSelecionado").textContent = `Selecionado: ${descricao} (Cod: ${codigo})`;
}

// ==========================================
// SALVAR MOVIMENTAÇÃO (O Coração da Coisa)
// ==========================================
// Atribuir ao botão no HTML: onclick="salvarMovimentacao()"
async function salvarMovimentacao() {
    if (!materialAtual) return alert("Selecione um material!");

    let quantidade = document.getElementById("quantidade").value;
    let preco = document.getElementById("preco").value || 0;
    let obs = document.getElementById("obs").value || "";
    let tipo = document.getElementById("tipoMov").value;
    let obra = document.getElementById("obraSelect").value;
    let dataAtual = new Date().toLocaleString('pt-BR');

    if (!quantidade || quantidade <= 0) return alert("Insira uma quantidade válida!");

    let mov = {
        action: 'movimentacao',
        chave: CHAVE,
        cod_obra: obra,
        cod_insumo: materialAtual.codigo,
        material_desc: materialAtual.descricao,
        tipo: tipo,
        quantidade: quantidade,
        preco_unit: preco,
        obs: obs,
        data: dataAtual
    };

    document.getElementById("statusSync").textContent = "Salvando...";

    try {
        if (navigator.onLine) {
            await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify(mov)
            });
            await db.historicoLocal.add(mov);
            alert("Movimentação salva com sucesso no sistema!");
        } else {
            throw new Error("Estou offline");
        }
    } catch (e) {
        // Sem net ou falhou? Guarda na gaveta pra enviar depois [cite: 69]
        await db.filaSync.add(mov);
        alert("Sinal fraco! Guardado no celular para sincronizar depois.");
    }

    limparFormulario();
    document.getElementById("statusSync").textContent = "";
    await carregarHistoricoCompleto();
}

function limparFormulario() {
    materialAtual = null;
    document.getElementById("formMovimentacao").style.display = "none";
    document.getElementById("quantidade").value = "";
    document.getElementById("preco").value = "";
    document.getElementById("obs").value = "";
    document.getElementById("materialSelecionado").textContent = "";
}

// ==========================================
// 4. CORREÇÃO: HISTÓRICO COM OFFLINE E ONLINE JUNTOS
// ==========================================
async function carregarHistoricoCompleto() {
    // Puxa o que já foi e o que está preso na fila [cite: 58, 62]
    const [historicoSalvo, itensOffline] = await Promise.all([
        db.historicoLocal.toArray(),
        db.filaSync.toArray()
    ]);

    let historicoGeral = [...historicoSalvo, ...itensOffline];

    // Inverte a ordem para os mais novos ficarem no topo (Dexie guarda o ID em ordem crescente)
    historicoGeral.reverse(); 
    let historicoFinal = historicoGeral.slice(0, 20);

    let html = "";
    historicoFinal.forEach(h => {
        let isOffline = itensOffline.some(offline => offline.id === h.id && offline.data === h.data);
        let badgeOffline = isOffline ? ` <span style="color:darkorange; font-size:12px;">(Pendente Sync ⏳)</span>` : ` <span style="color:green; font-size:12px;">(Sincronizado ✅)</span>`;
        let tipoStr = h.tipo === 'E' ? '<span style="color:green;font-weight:bold;">Entrada</span>' : '<span style="color:red;font-weight:bold;">Saída</span>';

        html += `
        <div class="cardHistorico" style="border:1px solid #ccc; padding:10px; margin-top:10px; border-radius:5px; background: #fafafa;">
            <b style="font-size: 14px;">${h.data}</b> ${badgeOffline}<br>
            <b>Insumo:</b> ${h.material_desc || h.cod_insumo}<br>
            <b>Movimento:</b> ${tipoStr}<br>
            <b>Qtd:</b> ${h.quantidade} | <b>Preço Unit:</b> R$ ${h.preco_unit}<br>
            <b>Obs:</b> ${h.obs || '-'}
        </div>`;
    });

    document.getElementById("historico").innerHTML = html || "<p style='margin-top:10px;'>Nenhum histórico no momento.</p>";
}

// ==========================================
// SINCRONIZAÇÃO EM SEGUNDO PLANO
// ==========================================
async function sincronizarPendentes() {
    if (!navigator.onLine) return;
    
    let pendentes = await db.filaSync.toArray();
    if (pendentes.length === 0) return;

    document.getElementById("statusSync").textContent = `Sincronizando ${pendentes.length} itens...`;

    for (let p of pendentes) {
        try {
            await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify(p)
            });
            
            let idOriginal = p.id;
            delete p.id; // Evita conflito na nova tabela
            
            await db.historicoLocal.add(p);
            await db.filaSync.delete(idOriginal); // Remove da fila do celular
        } catch (e) {
            console.log("Falha ao sincronizar item invisível", e);
        }
    }
    
    document.getElementById("statusSync").textContent = "";
    carregarHistoricoCompleto();
}
