const API_URL = 'https://script.google.com/macros/s/AKfycbyJ-6pGpbsIfZTHuMSz-PgezoziZSYZjCy5Nsd5MYHU1wn941915PnT2C92Vb2It1R8/exec';

const CHAVE = 'obra123teste';

const db = new Dexie("ObraEstoqueDB");

db.version(1).stores({
    filaSync: '++id,data',
    materiaisCache: 'codigo',
    obrasCache: 'id',
    historicoLocal: '++id,data'
});

let materialAtual = null;

window.onload = async function(){

    atualizarStatusConexao();

    window.addEventListener(
        'online',
        atualizarStatusConexao
    );

    window.addEventListener(
        'offline',
        atualizarStatusConexao
    );

    window.addEventListener(
        'online',
        sincronizarPendentes
    );

    await Promise.all([
        carregarObras(),
        carregarMateriais(),
        carregarHistorico()
    ]);

};

function atualizarStatusConexao(){

    document.getElementById(
        "statusConexao"
    ).innerText =
        navigator.onLine
            ? "🟢 Online"
            : "🔴 Offline";

}

async function carregarObras(){

    try{

        // CACHE PRIMEIRO
        let obrasLocal =
            await db.obrasCache.toArray();

        if(obrasLocal.length > 0){

            preencherObras(obrasLocal);

        }

        // ONLINE DEPOIS
        let resp = await fetch(
            `${API_URL}?chave=${CHAVE}&action=obras`
        );

        let obras = await resp.json();

        await db.obrasCache.clear();

        for(let o of obras){

            await db.obrasCache.put({
                id: String(o[0]),
                nome: String(o[1])
            });

        }

        let obrasAtualizadas =
            await db.obrasCache.toArray();

        preencherObras(obrasAtualizadas);

    }catch(e){

        console.log(
            "Usando cache local das obras"
        );

    }
}

function preencherObras(obras){

    let select =
        document.getElementById("obraSelect");

    select.innerHTML = "";

    obras.forEach(o=>{

        let op =
            document.createElement("option");

        op.value = o.id;

        op.textContent = o.nome;

        select.appendChild(op);

    });

}

async function carregarMateriais(){

    try{

        let resp = await fetch(
            `${API_URL}?chave=${CHAVE}&action=insumos`
        );

        let mats = await resp.json();

        await db.materiaisCache.clear();

        for(let m of mats){

            await db.materiaisCache.put({

                codigo: String(m[0] || ''),

                descricao: String(m[1] || ''),

                categoria: String(m[2] || ''),

                unidade: String(m[3] || '')

            });

        }

    }catch(e){

        console.log(
            "Materiais carregados do cache local"
        );

    }
}

document
.getElementById("buscaMaterial")
.addEventListener(
    "keyup",
    async function(){

        let termo =
            this.value
            .toLowerCase()
            .trim();

        let resultado =
            document.getElementById(
                "resultadoBusca"
            );

        if(termo.length < 1){

            resultado.innerHTML = "";

            return;

        }

        let todos =
            await db.materiaisCache.toArray();

        let filtrados =
            todos.filter(m =>

                m.codigo
                .toLowerCase()
                .includes(termo)

                ||

                m.descricao
                .toLowerCase()
                .includes(termo)

            )
            .slice(0,15);

        resultado.innerHTML = "";

        filtrados.forEach(m=>{

            let div =
                document.createElement("div");

            div.className = "itemBusca";

            // textContent resolve bug das aspas
            div.textContent =
                `${m.codigo} - ${m.descricao} (${m.unidade})`;

            // clique seguro
            div.addEventListener(
                "click",
                function(){

                    selecionarMaterial(
                        String(m.codigo),
                        String(m.descricao),
                        String(m.unidade)
                    );

                }
            );

            resultado.appendChild(div);

        });

    }
);

function selecionarMaterial(
    cod,
    desc,
    un
){

    materialAtual = {
        codigo: cod,
        descricao: desc,
        unidade: un
    };

    document.getElementById(
        "materialSelecionado"
    ).innerText =
        `${cod} - ${desc} (${un})`;

    document.getElementById(
        "formMovimentacao"
    ).style.display = "block";

    document.getElementById(
        "resultadoBusca"
    ).innerHTML = "";

}

async function salvarMovimentacao(){

    if(!materialAtual){

        alert("Selecione um material");

        return;

    }

    let quantidade =
        document.getElementById(
            "quantidade"
        ).value;

    if(
        !quantidade ||
        Number(quantidade) <= 0
    ){

        alert("Informe a quantidade");

        return;

    }

    let mov = {

        chave: CHAVE,

        id_obra:
            document.getElementById(
                "obraSelect"
            ).value,

        cod_insumo:
            materialAtual.codigo,

        material_desc:
            materialAtual.descricao,

        tipo:
            document.getElementById(
                "tipoMov"
            ).value,

        quantidade:
            quantidade,

        preco_unit:
            document.getElementById(
                "preco"
            ).value || 0,

        obs:
            document.getElementById(
                "obs"
            ).value || '',

        data:
            new Date()
            .toLocaleString()

    };

    // salva no histórico imediatamente
    await db.historicoLocal.add(mov);

    // força IndexedDB concluir escrita
    await db.historicoLocal.toArray();

    if(navigator.onLine){

        try{

            await fetch(
                API_URL,
                {
                    method:"POST",
                    body: JSON.stringify(mov)
                }
            );

            alert(
                "Movimentação salva com sucesso"
            );

        }catch(e){

            await db.filaSync.add(mov);

            alert(
                "Internet instável. Ficou pendente."
            );

        }

    }else{

        await db.filaSync.add(mov);

        alert(
            "Offline. Movimentação guardada."
        );

    }

    limparFormulario();

    await carregarHistorico();

}

async function sincronizarPendentes(){

    let pendentes =
        await db.filaSync.toArray();

    for(let p of pendentes){

        try{

            await fetch(
                API_URL,
                {
                    method:"POST",
                    body:JSON.stringify(p)
                }
            );

            await db.filaSync.delete(p.id);

        }catch(e){

            console.log(
                "Ainda existem pendências"
            );

        }

    }

}

async function carregarHistorico(){

    let hist =
        await db.historicoLocal
        .orderBy('id')
        .reverse()
        .limit(20)
        .toArray();

    let html = "";

    hist.forEach(h=>{

        html += `

        <div class="cardHistorico">

            <b>${h.data}</b><br>

            Material:
            ${h.material_desc || h.cod_insumo}
            <br>

            Tipo:
            ${
                h.tipo == 'E'
                ? 'Entrada'
                : 'Saída'
            }
            <br>

            Quantidade:
            ${h.quantidade}
            <br>

            Preço:
            R$ ${h.preco_unit}
            <br>

            Obs:
            ${h.obs || '-'}

        </div>

        `;

    });

    document.getElementById(
        "historico"
    ).innerHTML = html;

}

function limparFormulario(){

    materialAtual = null;

    document.getElementById(
        "quantidade"
    ).value = "";

    document.getElementById(
        "preco"
    ).value = "";

    document.getElementById(
        "obs"
    ).value = "";

    document.getElementById(
        "formMovimentacao"
    ).style.display = "none";

}
