/*
 * Modelo de site para pousadas — lê todo o conteúdo de data.json.
 * Não é preciso editar este arquivo para trocar textos ou fotos.
 */
(() => {
  'use strict';

  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  // Mapa vetorial gratuito e sem chave (OpenFreeMap, estilo "liberty", parecido com o Google Maps)
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_LEAFLET = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js';
  const ESTILO_MAPA = 'https://tiles.openfreemap.org/styles/liberty';
  const ATRIBUICAO_VETORIAL = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const MOVIMENTO_REDUZIDO = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const FONTES = {
    estabelecimento: 'Informado pelo estabelecimento',
    google: 'Fonte: Google Maps',
    pousada: 'Informação da equipe da pousada',
    osm: 'Localização: OpenStreetMap'
  };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  let D = null;              // conteúdo do data.json
  const galerias = new Map(); // id -> lista de fotos (para o lightbox)

  /* ---------- utilitários ---------- */

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (nome, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${esc(nome)}"/></svg>`;
  const lista = (v) => (Array.isArray(v) ? v : []);

  // Nos cards usa a versão leve da foto ("mini", 720 px); a grande só é baixada ao ampliar (lightbox)
  function img(foto, { classe = '', lazy = true, prioridade = false } = {}) {
    if (!foto || !foto.src) return '';
    return `<img src="${esc(foto.mini || foto.src)}" alt="${esc(foto.alt)}"${classe ? ` class="${classe}"` : ''}` +
      `${lazy ? ' loading="lazy"' : ''} decoding="async"${prioridade ? ' fetchpriority="high"' : ''}>`;
  }

  function registrarGaleria(id, fotos) {
    galerias.set(id, lista(fotos).filter((f) => f && f.src));
    return id;
  }

  // Botão que abre uma foto no lightbox
  function fotoBotao(galeriaId, i, foto, classe = '', extra = '') {
    return `<button type="button" class="foto ${classe}" data-galeria="${esc(galeriaId)}" data-indice="${i}" aria-label="Ampliar foto: ${esc(foto.alt)}">${img(foto)}${extra}</button>`;
  }

  function cabecalho(s, centro = false) {
    return `<header class="secao__cab${centro ? ' secao__cab--centro' : ''} revelar">
      ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ''}
      <h2>${esc(s.titulo)}</h2>
    </header>`;
  }

  function whatsUrl(msg) {
    const n = String(D.pousada.whatsapp || '').replace(/\D/g, '');
    if (!n) return '';
    return `https://wa.me/${n}?text=${encodeURIComponent(msg || D.pousada.whatsappMensagem || '')}`;
  }

  const coord = (c) => `${c[0]},${c[1]}`;
  const mapsLocalUrl = () => D.pousada.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${coord(D.pousada.coordenadas)}`;
  const mapsRotaUrl = (destino, origem) =>
    `https://www.google.com/maps/dir/?api=1${origem ? `&origin=${coord(origem)}` : ''}&destination=${coord(destino)}&travelmode=driving`;

  function linkExterno(href, conteudo, classe) {
    if (!href) return '';
    const externo = /^https?:/.test(href);
    return `<a class="${classe}" href="${esc(href)}"${externo ? ' target="_blank" rel="noopener"' : ''}>${conteudo}</a>`;
  }

  function fmtKm(km) {
    if (km == null || isNaN(km)) return '';
    if (km < 1) return `${Math.round(km * 100) * 10} m`;
    return `${km.toLocaleString('pt-BR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
  }

  function fmtMin(min) {
    if (min == null || isNaN(min)) return '';
    min = Math.max(1, Math.round(min));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  function fmtMes(aaaamm) {
    const m = /^(\d{4})-(\d{2})/.exec(aaaamm || '');
    return m ? `${MESES[+m[2] - 1]}/${m[1]}` : '';
  }

  // Distância em linha reta (km) — usada só se a rota ainda não foi gerada
  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function infoDistancia(local) {
    const temRota = Array.isArray(local.rota) && local.rota.length > 1;
    const km = local.distanciaKm ?? haversine(D.pousada.coordenadas, local.coordenadas);
    return {
      temRota,
      km,
      kmTexto: (local.distanciaKm == null ? '~' : '') + fmtKm(km),
      carro: fmtMin(local.tempoCarroMin),
      pe: local.tempoPeMin != null && local.tempoPeMin <= 90 ? fmtMin(local.tempoPeMin) : ''
    };
  }

  /* ---------- seções ---------- */

  const secoes = {
    hero(h) {
      const p = D.pousada, e = D.ecovip;
      return `
        <picture>
          ${h.imagemMobile ? `<source media="(max-width: 720px)" srcset="${esc(h.imagemMobile)}">` : ''}
          ${img({ src: h.imagem, alt: h.alt }, { classe: 'hero__img', lazy: false, prioridade: true })}
        </picture>
        <div class="hero__veu"></div>
        <div class="hero__conteudo container">
          <h1 class="hero__nome">${esc(p.nome).replace(/^(Pousada)\s+/i, '<span class="hero__pre">$1</span>')}</h1>
          ${p.regiao ? `<p class="hero__regiao">${esc(p.regiao)}</p>` : ''}
          ${h.frase ? `<p class="hero__frase">${esc(h.frase)}</p>` : ''}
          <a class="hero__rolar" href="#conheca">
            <span>Role para baixo</span>
            <span class="hero__rolar-seta">${ico('seta-dir')}</span>
          </a>
        </div>
        ${e && e.logo ? linkExterno(e.url, `<img src="${esc(e.logo)}" alt="Pousada da rede ${esc(e.nome || 'EcoVip')}" width="110" height="30">`, 'hero__ecovip') : ''}`;
    },

    sobre(s) {
      const g = registrarGaleria('sobre', s.fotos);
      const fotos = galerias.get(g);
      return `<div class="container sobre">
        <div class="sobre__texto">
          ${cabecalho(s)}
          ${lista(s.textos).map((t) => `<p class="revelar">${esc(t)}</p>`).join('')}
        </div>
        <div class="mosaico mosaico--${Math.min(fotos.length, 5)} revelar">
          ${fotos.map((f, i) => fotoBotao(g, i, f)).join('')}
        </div>
      </div>`;
    },

    acomodacoes(s) {
      return `<div class="container">
        ${cabecalho(s)}
        <div class="quartos">
          ${lista(s.itens).map((q) => {
            // tudo do quarto aparece direto no card (sem precisar clicar)
            const g = registrarGaleria(`quarto-${q.id}`, q.fotos);
            return `<article class="quarto revelar">
              ${fotosDoCard(g)}
              <div class="quarto__corpo">
                <h3>${esc(q.nome)}</h3>
                ${q.chamada ? `<p class="quarto__chamada">${esc(q.chamada)}</p>` : ''}
                <ul class="fatos fatos--grande">
                  ${q.capacidade ? `<li>${ico('pessoas')} <span><small>Capacidade</small>Até ${esc(q.capacidade)} pessoas</span></li>` : ''}
                  ${q.camas ? `<li>${ico('cama')} <span><small>Camas</small>${esc(q.camas)}</span></li>` : ''}
                </ul>
                ${lista(q.caracteristicas).length ? `<h4 class="detalhe__titulo">Características</h4><ul class="marcadores">${q.caracteristicas.map((c) => `<li>${ico('check')} ${esc(c)}</li>`).join('')}</ul>` : ''}
                ${lista(q.disponivel).length ? `<h4 class="detalhe__titulo">O que tem no quarto</h4><ul class="comodidades">${q.disponivel.map((c) => `<li>${ico(c.icone || 'check')} ${esc(c.texto)}</li>`).join('')}</ul>` : ''}
                ${lista(q.informacoes).length ? `<h4 class="detalhe__titulo">Informações importantes</h4><ul class="marcadores marcadores--info">${q.informacoes.map((c) => `<li>${ico('info')} ${esc(c)}</li>`).join('')}</ul>` : ''}
              </div>
            </article>`;
          }).join('')}
        </div>
      </div>`;
    },

    areaExterna(s) {
      const g = registrarGaleria('externa', s.fotos);
      return `<div class="container">
        ${cabecalho(s)}
        ${s.texto ? `<p class="secao__intro">${esc(s.texto)}</p>` : ''}
      </div>
      <div class="externa">
        ${galerias.get(g).map((f, i) => fotoBotao(g, i, f, 'revelar', f.legenda ? `<span class="foto__legenda">${esc(f.legenda)}</span>` : '')).join('')}
      </div>`;
    },

    localizacao(s) {
      const p = D.pousada;
      const item = (rotulo, texto) => (texto ? `<div><dt>${rotulo}</dt><dd>${esc(texto)}</dd></div>` : '');
      // sem mapa aqui: só o endereço e um botão grande que abre o Google Maps
      return `<div class="container local-pousada">
        ${cabecalho(s)}
        <div class="cartao local-pousada__info revelar">
          <p class="local-pousada__nome">${ico('pin')} ${esc(p.nome)}${p.regiao ? ` — ${esc(p.regiao)}` : ''}</p>
          <dl class="definicoes">
            ${item('Endereço', p.endereco)}
            ${item('Como chegar', s.comoChegar)}
            ${item('Ponto de referência', s.referencia)}
          </dl>
          ${linkExterno(mapsLocalUrl(), `${ico('mapa')} Abrir no Google Maps`, 'botao botao--primario botao--grande botao--largo local-pousada__botao')}
        </div>
      </div>`;
    },

    proximidades(s) {
      const cats = lista(s.categorias).filter((c) => lista(s.locais).some((l) => l.categoria === c.id));
      return `<div class="container">
        ${cabecalho(s)}
        <div class="chips" role="tablist" aria-label="Categorias">
          ${cats.map((c, i) => `<button type="button" class="chip" role="tab" data-categoria="${esc(c.id)}" aria-selected="${i === 0}">${ico(c.icone)} ${esc(c.nome)}</button>`).join('')}
        </div>
        <div class="prox-locais" id="prox-locais" aria-live="polite"></div>
        <div class="mapa-caixa">
          <div class="mapa mapa--prox" id="mapa-prox" role="region" aria-label="Mapa da região"><span class="mapa__carregando">Carregando mapa…</span></div>
          <div class="mapa-resumo" id="mapa-resumo" hidden></div>
        </div>
        <p class="mapa-dica">${ico('info')} Toque em um lugar acima para ver o caminho no mapa. Para aproximar o mapa, use os botões + e −.</p>
        <div id="prox-detalhe" class="prox-detalhe" aria-live="polite"></div>
        ${s.aviso ? `<p class="nota">${ico('info')} ${esc(s.aviso)}</p>` : ''}
      </div>`;
    },

    fornecemos(s) {
      return `<div class="container">
        ${cabecalho(s)}
        <ul class="icones-grade">
          ${lista(s.itens).map((i) => `<li class="revelar">
            <span class="icone-bola">${ico(i.icone)}</span>
            <div><h3>${esc(i.titulo)}</h3>${i.texto ? `<p>${esc(i.texto)}</p>` : ''}</div>
          </li>`).join('')}
        </ul>
        ${s.observacao ? `<p class="nota">${ico('info')} ${esc(s.observacao)}</p>` : ''}
      </div>`;
    },

    regras(s) {
      return `<div class="container">
        ${cabecalho(s)}
        <p class="regras__rotulo">Não é permitido:</p>
        <ul class="regras">
          ${lista(s.itens).map((r) => `<li class="revelar">
            <span class="regras__ico">${ico(r.icone)}<span class="regras__barra"></span></span>
            <div><h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p></div>
          </li>`).join('')}
        </ul>
      </div>`;
    },

    infos(s) {
      return `<div class="container">
        ${cabecalho(s)}
        <div class="infos">
          ${lista(s.itens).map((it) => `<article class="info-bloco cartao revelar">
            <h3 class="info-bloco__titulo"><span class="icone-bola">${ico(it.icone || 'info')}</span> ${esc(it.titulo)}</h3>
            ${conteudoInfo(it)}
          </article>`).join('')}
        </div>
      </div>`;
    },

    beneficios(s) {
      const e = D.ecovip || {};
      return `<div class="container">
        ${e.logo ? `<img class="beneficios__logo" src="${esc(e.logo)}" alt="${esc(e.nome || 'EcoVip')}" width="110" height="30" loading="lazy">` : ''}
        ${cabecalho(s)}
        ${s.intro ? `<p class="beneficios__intro">${esc(s.intro)}</p>` : ''}
        <ol class="beneficios">
          ${lista(s.itens).map((b, i) => {
            // tudo do benefício aparece direto no card (sem precisar clicar)
            const d = b.detalhes || {};
            const g = registrarGaleria(`beneficio-${b.id}`, d.fotos);
            return `<li class="beneficio-card revelar">
              ${fotosDoCard(g)}
              <div class="beneficio-card__corpo">
                <span class="beneficios__num">${String(i + 1).padStart(2, '0')}</span>
                <h3>${esc(b.titulo)}</h3>
                ${b.texto ? `<p class="beneficio-card__resumo">${esc(b.texto)}</p>` : ''}
                ${d.destaque ? `<p class="modal__destaque">${esc(d.destaque)}</p>` : ''}
                ${lista(d.textos).map((t) => `<p>${esc(t)}</p>`).join('')}
                ${lista(d.blocos).map((bl) => `<h4 class="detalhe__titulo">${esc(bl.titulo)}</h4><ul class="marcadores">${lista(bl.itens).map((c) => `<li>${ico('check')} ${esc(c)}</li>`).join('')}</ul>`).join('')}
                ${d.nota ? `<p class="nota">${ico('info')} ${esc(d.nota)}</p>` : ''}
                ${botoesDetalhe(d.botoes)}
              </div>
            </li>`;
          }).join('')}
        </ol>
        ${s.fecho ? `<p class="beneficios__fecho">${ico('folha')} ${esc(s.fecho)}</p>` : ''}
        ${s.url ? linkExterno(s.url, esc(s.botao || 'Conheça todos os benefícios'), 'botao botao--claro') : ''}
      </div>`;
    },

    experiencias(s) {
      return `<div class="container">
        ${cabecalho(s)}
        <div class="experiencias">
          ${lista(s.itens).map((x) => {
            const g = registrarGaleria(`exp-${x.id}`, x.fotos);
            const fotos = galerias.get(g);
            return `<article class="experiencia revelar">
              <div class="experiencia__fotos">
                ${fotos.slice(0, 3).map((f, i) => fotoBotao(g, i, f)).join('')}
              </div>
              <div class="experiencia__corpo">
                <h3>${esc(x.nome)}</h3>
                <p>${esc(x.chamada)}</p>
                <button type="button" class="botao botao--contorno" ${x.beneficio ? `data-beneficio="${esc(x.beneficio)}"` : `data-experiencia="${esc(x.id)}"`}>${esc(x.botao || 'Saiba mais')}</button>
              </div>
            </article>`;
          }).join('')}
        </div>
      </div>`;
    },

    galeria(s) {
      const g = registrarGaleria('galeria', s.fotos);
      return `<div class="container">
        ${cabecalho(s, true)}
        <div class="galeria">
          ${galerias.get(g).map((f, i) => fotoBotao(g, i, f, 'revelar')).join('')}
        </div>
      </div>`;
    }
  };

  function rodape() {
    const p = D.pousada, e = D.ecovip || {};
    const botoes = [
      [p.site, 'site', 'Nosso site'],
      [p.instagram, 'instagram', 'Instagram'],
      [whatsUrl(), 'whatsapp', 'WhatsApp'],
      [mapsLocalUrl(), 'mapa', 'Google Maps'],
      // botões da rede EcoVip, em todas as pousadas
      [e.site, 'site', 'Site EcoVip'],
      [e.instagram, 'instagram', 'Instagram EcoVip']
    ].filter(([u]) => u);
    return `<div class="container rodape__caixa">
      <div class="rodape__marca">
        ${p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.nome)}" width="160" height="48" loading="lazy">` : `<strong>${esc(p.nome)}</strong>`}
        ${p.regiao ? `<p>${esc(p.regiao)}</p>` : ''}
      </div>
      <nav class="rodape__links" aria-label="Contatos e redes">
        ${botoes.map(([u, i, t]) => linkExterno(u, `${ico(i)} ${t}`, 'botao botao--rodape')).join('')}
      </nav>
      <div class="rodape__base">
        ${e.logo ? linkExterno(e.url, `<span>Pousada da rede</span> <img src="${esc(e.logo)}" alt="${esc(e.nome || 'EcoVip')}" width="90" height="24" loading="lazy">`, 'rodape__ecovip') : ''}
        <small>© ${new Date().getFullYear()} ${esc(p.nome)}</small>
      </div>
    </div>`;
  }

  /* ---------- modal (acomodação / experiência) ---------- */

  const modal = $('#modal');

  function abrirModal(html) {
    $('.modal__conteudo', modal).innerHTML = html;
    modal.showModal();
    document.documentElement.classList.add('travado');
    $('.modal__caixa', modal).scrollTop = 0;
  }

  function faixaFotos(g) {
    // a primeira foto da faixa carrega na hora (as demais só quando roladas)
    return `<div class="faixa">${galerias.get(g).map((f, i) => fotoBotao(g, i, f)).join('')}</div>`.replace(' loading="lazy"', '');
  }

  // Fotos de um card: faixa que se arrasta para o lado, com um aviso escrito de quantas fotos há
  function fotosDoCard(g) {
    const n = galerias.get(g).length;
    if (!n) return '';
    return `<div class="faixa faixa--card">${galerias.get(g).map((f, i) => fotoBotao(g, i, f)).join('')}</div>
      ${n > 1 ? `<p class="faixa__dica">${ico('camera')} ${n} fotos — arraste para o lado para ver todas</p>` : ''}`;
  }

  // Botões de um benefício (catálogo, telefone…) — escritos por extenso, sem ícone sozinho
  function botoesDetalhe(botoes) {
    const html = lista(botoes).map((bt) => {
      const href = bt.whatsapp ? whatsUrl(bt.whatsapp) : bt.url;
      return linkExterno(href, `${ico(bt.icone || (bt.whatsapp ? 'whatsapp' : 'site'))} ${esc(bt.texto)}`, bt.whatsapp ? 'botao botao--whats botao--largo' : 'botao botao--primario botao--largo');
    }).join('');
    return html ? `<div class="acoes acoes--coluna">${html}</div>` : '';
  }

  // Informações úteis (ônibus, taxistas, delivery) mostradas direto na página
  function conteudoInfo(it) {
    const contatos = lista(it.contatos).map((c) => `<li class="contato">
        <span class="contato__nome"><strong>${esc(c.nome)}</strong><small>${esc(fmtTel(c.telefone))}</small></span>
        <a class="botao botao--contorno botao--pequeno contato__ligar" href="tel:+${telInternacional(c.telefone)}">${ico('telefone')} Ligar</a>
      </li>`).join('');
    return `
      ${lista(it.textos).map((t) => `<p>${esc(t)}</p>`).join('')}
      ${contatos ? `<ul class="contatos">${contatos}</ul>` : ''}
      ${lista(it.passos).length ? `<h4 class="detalhe__titulo">Passo a passo</h4><ol class="passos">${it.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      ${lista(it.blocos).map((bl) => `<h4 class="detalhe__titulo">${esc(bl.titulo)}</h4><ul class="marcadores marcadores--info">${lista(bl.itens).map((c) => `<li>${ico('info')} ${esc(c)}</li>`).join('')}</ul>`).join('')}
      ${it.nota ? `<p class="nota">${ico('info')} ${esc(it.nota)}</p>` : ''}
      ${botoesDetalhe(it.botoes)}`;
  }

  function modalQuarto(id) {
    const q = lista(D.acomodacoes.itens).find((x) => x.id === id);
    if (!q) return;
    const g = `quarto-${q.id}`;
    abrirModal(`
      ${faixaFotos(g)}
      <div class="modal__texto">
        <h2>${esc(q.nome)}</h2>
        <p class="modal__chamada">${esc(q.chamada)}</p>
        <ul class="fatos fatos--grande">
          ${q.capacidade ? `<li>${ico('pessoas')} <span><small>Capacidade</small>Até ${esc(q.capacidade)} pessoas</span></li>` : ''}
          ${q.camas ? `<li>${ico('cama')} <span><small>Camas</small>${esc(q.camas)}</span></li>` : ''}
        </ul>
        ${lista(q.caracteristicas).length ? `<h3>Características</h3><ul class="marcadores">${q.caracteristicas.map((c) => `<li>${ico('check')} ${esc(c)}</li>`).join('')}</ul>` : ''}
        ${lista(q.disponivel).length ? `<h3>O que está disponível</h3><ul class="comodidades">${q.disponivel.map((c) => `<li>${ico(c.icone || 'check')} ${esc(c.texto)}</li>`).join('')}</ul>` : ''}
        ${lista(q.informacoes).length ? `<h3>Informações importantes</h3><ul class="marcadores marcadores--info">${q.informacoes.map((c) => `<li>${ico('info')} ${esc(c)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="modal__espaco"></div>`);
  }

  function modalExperiencia(id) {
    const x = lista(D.experiencias.itens).find((e) => e.id === id);
    if (!x) return;
    const g = `exp-${x.id}`;
    abrirModal(`
      ${faixaFotos(g)}
      <div class="modal__texto">
        <h2>${esc(x.nome)}</h2>
        <p class="modal__chamada">${esc(x.chamada)}</p>
        ${x.texto ? `<p>${esc(x.texto)}</p>` : ''}
        ${lista(x.detalhes).length ? `<h3>Como contratar</h3><ul class="marcadores">${x.detalhes.map((c) => `<li>${ico('check')} ${esc(c)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="modal__rodape">${linkExterno(whatsUrl(x.whatsappMensagem), `${ico('whatsapp')} Falar sobre ${esc(x.nome.toLowerCase())}`, 'botao botao--whats botao--largo')}</div>`);
  }

  // Benefício EcoVip: textos, listas (incluso, valores…), fotos e botões (links, telefone ou WhatsApp)
  // Telefones brasileiros: "31 9 9533-0608" → exibição "(31) 99533-0608" e "5531995330608" para links
  const soDigitos = (n) => String(n || '').replace(/\D/g, '');
  const telInternacional = (n) => { const d = soDigitos(n); return d.length <= 11 ? `55${d}` : d; };
  function fmtTel(n) {
    const m = /^(?:55)?(\d{2})(\d{4,5})(\d{4})$/.exec(soDigitos(n));
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(n);
  }

  // Informações úteis: lista de contatos (WhatsApp + ligar), passos, dicas e botões
  function modalInfo(id) {
    const it = lista(D.infos && D.infos.itens).find((x) => x.id === id);
    if (!it) return;
    const contatos = lista(it.contatos).map((c) => {
      const t = telInternacional(c.telefone);
      return `<li class="contato">
        <span class="contato__nome"><strong>${esc(c.nome)}</strong><small>${esc(fmtTel(c.telefone))}</small></span>
        <span class="contato__acoes">
          <a class="botao-ico" href="tel:+${t}" aria-label="Ligar para ${esc(c.nome)}">${ico('telefone')}</a>
        </span>
      </li>`;
    }).join('');
    const botoes = lista(it.botoes).map((bt) => linkExterno(bt.url, `${ico(bt.icone || 'mapa')} ${esc(bt.texto)}`, 'botao botao--primario botao--largo')).join('');
    abrirModal(`
      <div class="modal__texto modal__texto--topo">
        <p class="eyebrow">${ico(it.icone || 'info')} Informações úteis</p>
        <h2>${esc(it.titulo)}</h2>
        ${lista(it.textos).map((t) => `<p>${esc(t)}</p>`).join('')}
        ${contatos ? `<ul class="contatos">${contatos}</ul>` : ''}
        ${lista(it.passos).length ? `<h3>Passo a passo</h3><ol class="passos">${it.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
        ${lista(it.blocos).map((bl) => `<h3>${esc(bl.titulo)}</h3><ul class="marcadores marcadores--info">${lista(bl.itens).map((c) => `<li>${ico('info')} ${esc(c)}</li>`).join('')}</ul>`).join('')}
        ${it.nota ? `<p class="nota">${ico('info')} ${esc(it.nota)}</p>` : ''}
      </div>
      ${botoes ? `<div class="modal__rodape modal__rodape--varios">${botoes}</div>` : '<div class="modal__espaco"></div>'}`);
  }

  function modalBeneficio(id) {
    const b = lista(D.beneficios && D.beneficios.itens).find((x) => x.id === id);
    if (!b || !b.detalhes) return;
    const d = b.detalhes;
    const g = registrarGaleria(`beneficio-${b.id}`, d.fotos);
    const botoes = lista(d.botoes).map((bt) => {
      const href = bt.whatsapp ? whatsUrl(bt.whatsapp) : bt.url;
      const classe = bt.whatsapp ? 'botao botao--whats botao--largo' : 'botao botao--contorno botao--largo';
      return linkExterno(href, `${ico(bt.icone || (bt.whatsapp ? 'whatsapp' : 'site'))} ${esc(bt.texto)}`, classe);
    }).join('');
    abrirModal(`
      ${galerias.get(g).length ? faixaFotos(g) : ''}
      <div class="modal__texto">
        <p class="eyebrow">${ico('folha')} ${esc(b.rotulo || `Benefício ${(D.ecovip && D.ecovip.nome) || 'EcoVip'}`)}</p>
        <h2>${esc(b.titulo)}</h2>
        ${d.destaque ? `<p class="modal__destaque">${esc(d.destaque)}</p>` : ''}
        ${lista(d.textos).map((t) => `<p>${esc(t)}</p>`).join('')}
        ${lista(d.blocos).map((bl) => `<h3>${esc(bl.titulo)}</h3><ul class="marcadores">${lista(bl.itens).map((c) => `<li>${ico('check')} ${esc(c)}</li>`).join('')}</ul>`).join('')}
        ${d.nota ? `<p class="nota">${ico('info')} ${esc(d.nota)}</p>` : ''}
      </div>
      ${botoes ? `<div class="modal__rodape modal__rodape--varios">${botoes}</div>` : '<div class="modal__espaco"></div>'}`);
  }

  /* ---------- lightbox ---------- */

  const lb = $('#lightbox');
  const lbImg = $('img', lb), lbLeg = $('figcaption', lb);
  let lbFotos = [], lbI = 0;

  function lbMostrar(i) {
    lbI = (i + lbFotos.length) % lbFotos.length;
    const f = lbFotos[lbI];
    lbImg.src = f.src;
    lbImg.alt = f.alt || '';
    // sem nome de foto: só a contagem (e o crédito do fotógrafo, quando a licença exige)
    lbLeg.textContent = [lbFotos.length > 1 ? `${lbI + 1}/${lbFotos.length}` : '', f.credito ? `Foto: ${f.credito}` : ''].filter(Boolean).join('\n');
    lb.classList.toggle('lightbox--unica', lbFotos.length < 2);
    // pré-carrega a próxima
    if (lbFotos.length > 1) new Image().src = lbFotos[(lbI + 1) % lbFotos.length].src;
  }

  function lbAbrir(id, i) {
    lbFotos = galerias.get(id) || [];
    if (!lbFotos.length) return;
    lbMostrar(i);
    if (!lb.open) lb.showModal();
    document.documentElement.classList.add('travado');
  }

  $('[data-ant]', lb).addEventListener('click', () => lbMostrar(lbI - 1));
  $('[data-prox]', lb).addEventListener('click', () => lbMostrar(lbI + 1));
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') lbMostrar(lbI - 1);
    if (e.key === 'ArrowRight') lbMostrar(lbI + 1);
  });
  let toqueX = null;
  lb.addEventListener('touchstart', (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (toqueX == null) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    if (Math.abs(dx) > 45) lbMostrar(lbI + (dx < 0 ? 1 : -1));
    toqueX = null;
  });

  for (const dlg of [lb, modal]) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-fechar]')) dlg.close();
    });
    dlg.addEventListener('close', () => {
      if (!lb.open && !modal.open) document.documentElement.classList.remove('travado');
    });
  }

  /* ---------- mapas (Leaflet carregado só quando necessário) ---------- */

  function carregarArquivo(tipo, url) {
    return new Promise((ok, erro) => {
      const el = document.createElement(tipo === 'css' ? 'link' : 'script');
      if (tipo === 'css') { el.rel = 'stylesheet'; el.href = url; ok(); } else { el.src = url; el.onload = ok; el.onerror = erro; }
      document.head.appendChild(el);
    });
  }

  const temWebGL = () => {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  };

  // Leaflet + (quando possível) o mapa vetorial OpenFreeMap, com visual parecido com o Google Maps.
  // Se o mapa vetorial não carregar (navegador antigo, sem WebGL), usa o mapa simples em imagens.
  let leafletPromessa = null;
  let mapaVetorial = false;
  function carregarLeaflet() {
    if (leafletPromessa) return leafletPromessa;
    leafletPromessa = (async () => {
      carregarArquivo('css', LEAFLET_CSS);
      await carregarArquivo('js', LEAFLET_JS);
      if (cfgTiles().estilo && temWebGL()) {
        try {
          carregarArquivo('css', MAPLIBRE_CSS);
          await carregarArquivo('js', MAPLIBRE_JS);
          await carregarArquivo('js', MAPLIBRE_LEAFLET);
          mapaVetorial = typeof window.L.maplibreGL === 'function';
        } catch { mapaVetorial = false; }
      }
      return window.L;
    })();
    return leafletPromessa;
  }

  function cfgTiles() {
    const m = (D.proximidades && D.proximidades.mapa) || {};
    return {
      // "estilo": mapa vetorial (deixe "" no data.json para usar só o mapa simples)
      estilo: m.estilo ?? ESTILO_MAPA,
      url: m.tiles || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      atribuicao: m.atribuicao || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    };
  }

  function novoMapa(L, el) {
    el.innerHTML = '';
    const t = cfgTiles();
    // posição inicial já definida (o mapa vetorial exige; depois cada mapa enquadra o que precisa)
    // no celular o mapa fica parado: passar o dedo por cima sempre rola a página; para aproximar, só os botões + e −
    const toque = matchMedia('(pointer: coarse)').matches;
    const mapa = L.map(el, { scrollWheelZoom: false, tap: false, zoomSnap: 0.5, dragging: !toque, touchZoom: !toque, doubleClickZoom: !toque, boxZoom: false, keyboard: false })
      .setView(D.pousada.coordenadas, 13);
    const simples = () => L.tileLayer(t.url, { maxZoom: 18, attribution: t.atribuicao }).addTo(mapa);
    if (!mapaVetorial) { simples(); return mapa; }
    const gl = L.maplibreGL({ style: t.estilo, attribution: ATRIBUICAO_VETORIAL }).addTo(mapa);
    // se o mapa vetorial falhar ou não carregar em 10 s, troca para o mapa simples (nunca fica em branco)
    let trocou = false;
    const trocar = () => {
      if (trocou) return;
      trocou = true;
      try { mapa.removeLayer(gl); } catch {}
      simples();
    };
    try {
      const ml = gl.getMaplibreMap();
      ml.on('error', (e) => console.warn('mapa:', e && e.error)); // erros pequenos (um ícone, uma fonte) não derrubam o mapa
      // o estilo do mapa chegou = mapa vetorial funcionando (não depende de todos os pedaços terem carregado)
      let estiloOk = false;
      ml.once('styledata', () => { estiloOk = true; });
      // conta só o tempo com a página visível (aba em segundo plano pausa o desenho do mapa)
      let segundos = 0;
      const vigia = setInterval(() => {
        if (trocou || estiloOk) { clearInterval(vigia); return; }
        if (!document.hidden && ++segundos >= 10) { clearInterval(vigia); trocar(); }
      }, 1000);
    } catch { trocar(); }
    return mapa;
  }

  function iconePousada(L) {
    return L.divIcon({
      className: '',
      html: `<span class="marcador marcador--pousada">${ico('folha')}</span>`,
      iconSize: [40, 40], iconAnchor: [20, 40]
    });
  }

  function iconeLocal(L, nomeIcone, ativo) {
    return L.divIcon({
      className: '',
      html: `<span class="marcador${ativo ? ' marcador--ativo' : ''}">${ico(nomeIcone)}</span>`,
      iconSize: [30, 30], iconAnchor: [15, 15]
    });
  }

  async function iniciarMapaPousada() {
    const el = $('#mapa-pousada');
    if (!el || el.dataset.pronto) return;
    el.dataset.pronto = '1';
    try {
      const L = await carregarLeaflet();
      const p = D.pousada;
      const mapa = novoMapa(L, el);
      mapa.setView(p.coordenadas, 14);
      L.marker(p.coordenadas, { icon: iconePousada(L), title: p.nome }).addTo(mapa)
        .bindPopup(`<strong>${esc(p.nome)}</strong><br><a href="${esc(mapsRotaUrl(p.coordenadas))}" target="_blank" rel="noopener">Abrir rota no Google Maps</a>`);
    } catch {
      el.innerHTML = '<span class="mapa__carregando">Não foi possível carregar o mapa.</span>';
    }
  }

  /* ---------- "O que tem perto" ---------- */

  const prox = { L: null, mapa: null, camadaMarcadores: null, camadaRota: null, marcadores: new Map(), categoria: null, local: null, anim: 0 };

  function catInfo(id) {
    return lista(D.proximidades.categorias).find((c) => c.id === id) || { nome: '', icone: 'pin' };
  }

  function locaisDa(cat) {
    return lista(D.proximidades.locais).filter((l) => l.categoria === cat);
  }

  function selecionarCategoria(cat) {
    prox.categoria = cat;
    prox.local = null;
    $$('#proximidades .chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.categoria === cat)));
    const locais = locaisDa(cat);
    $('#prox-locais').innerHTML = locais.map((l) => {
      const d = infoDistancia(l);
      return `<button type="button" class="prox-card" data-local="${esc(l.id)}" aria-pressed="false">
        <span class="prox-card__foto">${img(lista(l.fotos)[0]) || ico(catInfo(l.categoria).icone)}</span>
        <span class="prox-card__texto">
          <strong>${esc(l.nome)}</strong>
          <small>${ico('pin')} ${esc(d.kmTexto)}${d.carro ? ` · ${ico('carro')} ${esc(d.carro)}` : ''}</small>
        </span>
      </button>`;
    }).join('');
    $('#prox-detalhe').innerHTML = `<p class="prox-detalhe__vazio">${ico('pin')} Toque em um local para ver o caminho desde a ${esc(D.pousada.nome)}.</p>`;
    $('#mapa-resumo').hidden = true;
    atualizarMarcadores();
  }

  function atualizarMarcadores() {
    const { L, mapa } = prox;
    if (!mapa) return;
    cancelAnimationFrame(prox.anim);
    prox.camadaRota.clearLayers();
    prox.camadaMarcadores.clearLayers();
    prox.marcadores.clear();
    const locais = locaisDa(prox.categoria);
    const pontos = [D.pousada.coordenadas];
    for (const l of locais) {
      const m = L.marker(l.coordenadas, { icon: iconeLocal(L, catInfo(l.categoria).icone, false), title: l.nome })
        .on('click', () => selecionarLocal(l.id))
        .addTo(prox.camadaMarcadores);
      prox.marcadores.set(l.id, m);
      pontos.push(l.coordenadas);
    }
    mapa.fitBounds(L.latLngBounds(pontos), { padding: [36, 36], maxZoom: 15 });
  }

  // Créditos de fotos com licença livre (ex.: Wikimedia Commons) — exigidos pela licença
  function creditosFotos(fotos) {
    const com = lista(fotos).filter((f) => f.credito);
    if (!com.length) return '';
    return `<p class="local__fonte">Fotos: ${com.map((f) => (f.creditoUrl
      ? `<a href="${esc(f.creditoUrl)}" target="_blank" rel="noopener">${esc(f.credito)}</a>`
      : esc(f.credito))).join(' · ')}</p>`;
  }

  function cartaoLocal(l) {
    const d = infoDistancia(l);
    const cat = catInfo(l.categoria);
    const g = registrarGaleria(`local-${l.id}`, l.fotos);
    const fonte = [FONTES[l.fonte] || l.fonte, l.atualizadoEm ? `conferido em ${fmtMes(l.atualizadoEm)}` : ''].filter(Boolean).join(' · ');
    return `<article class="local cartao">
      ${galerias.get(g).length ? faixaFotos(g) : ''}
      <div class="local__corpo">
        <p class="eyebrow">${ico(cat.icone)} ${esc(cat.nome)}</p>
        <h3>${esc(l.nome)}</h3>
        <ul class="local__fatos">
          <li>${ico('pin')} <span>${esc(d.kmTexto)} da ${esc(D.pousada.nome)}${l.acessoNome ? ` até ${esc(l.acessoNome)}` : ''}${d.temRota ? '' : ' (em linha reta)'}</span></li>
          ${d.carro ? `<li>${ico('carro')} <span>${esc(d.carro)} de carro${l.acessoNome ? ` até ${esc(l.acessoNome)}` : ''}</span></li>` : ''}
          ${d.pe ? `<li>${ico('pe')} <span>${esc(d.pe)} a pé</span></li>` : ''}
          ${l.acessoTexto ? `<li>${ico('trilha')} <span>${esc(l.acessoTexto)}</span></li>` : ''}
        </ul>
        ${l.descricao ? `<h4>O que você encontra</h4><p>${esc(l.descricao)}</p>` : ''}
        <dl class="definicoes definicoes--duas">
          ${l.preco ? `<div><dt>${ico('preco')} ${esc(l.precoTipo || 'Valor')}</dt><dd>${esc(l.preco)}</dd></div>` : ''}
          ${l.funcionamento ? `<div><dt>${ico('relogio')} Funcionamento</dt><dd>${esc(l.funcionamento)}</dd></div>` : ''}
        </dl>
        ${fonte ? `<p class="local__fonte">${esc(fonte)}</p>` : ''}
        ${creditosFotos(galerias.get(g))}
        <div class="acoes">
          <button type="button" class="botao botao--primario" data-como-chegar="${esc(l.id)}">${ico('rota')} Como chegar</button>
          ${linkExterno(l.googleMapsUrl || mapsRotaUrl(l.acessoCarro || l.coordenadas, D.pousada.coordenadas), `${ico('mapa')} Abrir no Google Maps`, 'botao botao--contorno')}
        </div>
      </div>
    </article>`;
  }

  async function selecionarLocal(id, rolarParaMapa = false) {
    const l = lista(D.proximidades.locais).find((x) => x.id === id);
    if (!l) return;
    if (l.categoria !== prox.categoria) selecionarCategoria(l.categoria);
    prox.local = l;
    $$('#prox-locais .prox-card').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.local === id)));
    $('#prox-detalhe').innerHTML = cartaoLocal(l);
    if (rolarParaMapa) $('#mapa-prox').scrollIntoView({ behavior: MOVIMENTO_REDUZIDO ? 'auto' : 'smooth', block: 'center' });
    await iniciarMapaProx();
    if (!prox.mapa) return;
    for (const [lid, m] of prox.marcadores) m.setIcon(iconeLocal(prox.L, catInfo(prox.categoria).icone, lid === id));
    desenharRota(l);
  }

  // Desenha o caminho pousada → destino de forma animada (com um ponto "andando")
  function desenharRota(l) {
    const { L, mapa } = prox;
    cancelAnimationFrame(prox.anim);
    prox.camadaRota.clearLayers();
    $('#mapa-resumo').hidden = true;

    const d = infoDistancia(l);
    const pts = d.temRota ? l.rota : [D.pousada.coordenadas, l.coordenadas];
    const estilo = getComputedStyle(document.documentElement);
    const cor = estilo.getPropertyValue('--cor-destaque').trim() || estilo.getPropertyValue('--cor-primaria').trim() || '#a4562f';

    const contorno = L.polyline([], { color: '#fff', weight: 9, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(prox.camadaRota);
    const linha = L.polyline([], { color: cor, weight: 5, lineCap: 'round', lineJoin: 'round', dashArray: d.temRota ? null : '2 10', interactive: false }).addTo(prox.camadaRota);
    const ponto = L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 3, fillColor: cor, fillOpacity: 1, interactive: false }).addTo(prox.camadaRota);

    // deixa espaço para o quadro de resumo (embaixo no celular, à direita no computador)
    const largo = matchMedia('(min-width: 900px)').matches;
    mapa.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 40], paddingBottomRight: largo ? [380, 40] : [40, 150], maxZoom: 16 });

    // distâncias acumuladas para animar com velocidade constante
    const acum = [0];
    for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + haversine(pts[i - 1], pts[i]));
    const total = acum[acum.length - 1] || 1;
    const duracao = MOVIMENTO_REDUZIDO ? 0 : Math.min(3200, Math.max(1300, 900 + total * 160));
    const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const quadro = (inicio) => (agora) => {
      const t = duracao ? Math.min(1, (agora - inicio) / duracao) : 1;
      const alvo = suave(t) * total;
      let i = 1;
      while (i < acum.length - 1 && acum[i] < alvo) i++;
      const seg = acum[i] - acum[i - 1] || 1;
      const f = Math.min(1, Math.max(0, (alvo - acum[i - 1]) / seg));
      const a = pts[i - 1], b = pts[i];
      const atual = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const parcial = pts.slice(0, i).concat([atual]);
      contorno.setLatLngs(parcial);
      linha.setLatLngs(parcial);
      ponto.setLatLng(atual);
      if (t < 1) prox.anim = requestAnimationFrame(quadro(inicio));
      else mostrarResumo(l, d);
    };
    // pequena espera para o mapa terminar de enquadrar a rota
    setTimeout(() => { prox.anim = requestAnimationFrame((t0) => quadro(t0)(t0)); }, MOVIMENTO_REDUZIDO ? 0 : 350);
  }

  function mostrarResumo(l, d) {
    const el = $('#mapa-resumo');
    el.innerHTML = `
      <p class="mapa-resumo__trajeto"><strong>${esc(D.pousada.nome)}</strong> ${ico('seta-dir')} <strong>${esc(l.nome)}</strong></p>
      <p class="mapa-resumo__dados">
        ${d.carro ? `<span>${ico('carro')} Aprox. ${esc(d.carro)}</span>` : ''}
        <span>${ico('pin')} ${esc(d.kmTexto)}</span>
      </p>
      ${linkExterno(l.googleMapsUrl || mapsRotaUrl(l.acessoCarro || l.coordenadas, D.pousada.coordenadas), `${ico('mapa')} Abrir no Google Maps`, 'botao botao--pequeno botao--primario')}`;
    el.hidden = false;
  }

  async function iniciarMapaProx() {
    if (prox.mapa) return;
    const el = $('#mapa-prox');
    if (!el || el.dataset.pronto) return prox.promessa;
    el.dataset.pronto = '1';
    prox.promessa = (async () => {
      try {
        const L = await carregarLeaflet();
        prox.L = L;
        prox.mapa = novoMapa(L, el);
        prox.camadaRota = L.layerGroup().addTo(prox.mapa);
        prox.camadaMarcadores = L.layerGroup().addTo(prox.mapa);
        L.marker(D.pousada.coordenadas, { icon: iconePousada(L), title: D.pousada.nome, zIndexOffset: 1000 }).addTo(prox.mapa);
        atualizarMarcadores();
      } catch {
        el.innerHTML = '<span class="mapa__carregando">Não foi possível carregar o mapa.</span>';
      }
    })();
    return prox.promessa;
  }

  /* ---------- montagem ---------- */

  function aplicarTema() {
    const t = D.tema || {};
    const raiz = document.documentElement.style;
    if (t.primaria) raiz.setProperty('--cor-primaria', t.primaria);
    if (t.secundaria) raiz.setProperty('--cor-mata', t.secundaria);
    if (t.fundo) raiz.setProperty('--cor-fundo', t.fundo);
    if (t.texto) raiz.setProperty('--cor-texto', t.texto);
    if (t.destaque) raiz.setProperty('--cor-destaque', t.destaque);
    if (t.titulos) raiz.setProperty('--cor-titulo', t.titulos);
    if (t.areia) raiz.setProperty('--cor-areia', t.areia);
    // fontes (carregadas no index.html pelo ferramentas/preparar-compartilhamento.mjs)
    if (t.fonteTitulo) raiz.setProperty('--fonte-titulo', `'${t.fonteTitulo}', Georgia, 'Times New Roman', serif`);
    if (t.fonteTexto) raiz.setProperty('--fonte-texto', `'${t.fonteTexto}', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`);

    const m = D.meta || {};
    const titulo = m.titulo || `${D.pousada.nome} — ${D.pousada.regiao || ''}`;
    document.title = titulo;
    const setMeta = (sel, v) => { const el = $(sel); if (el && v) el.setAttribute('content', v); };
    setMeta('meta[name="description"]', m.descricao);
    setMeta('meta[property="og:title"]', titulo);
    setMeta('meta[property="og:description"]', m.descricao);
    setMeta('meta[property="og:image"]', m.imagemCompartilhamento);
    setMeta('meta[name="theme-color"]', m.corTema);
  }

  function montarTopo() {
    const p = D.pousada;
    $('[data-bind="logo-topo"]').innerHTML = p.logo
      ? `<img src="${esc(p.logo)}" alt="${esc(p.nome)}" width="145" height="36">`
      : `<span>${esc(p.nome)}</span>`;

    // o topo aparece depois da capa
    const hero = $('#inicio');
    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => {
        document.body.classList.toggle('passou-capa', !e.isIntersecting);
      }, { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
    }
  }

  function observarRevelar() {
    const els = $$('.revelar');
    if (MOVIMENTO_REDUZIDO || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('anima');
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { e.target.classList.add('visivel'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
  }

  function observarMapas() {
    const alvos = [['#localizacao', iniciarMapaPousada], ['#proximidades', iniciarMapaProx]];
    if (!('IntersectionObserver' in window)) { alvos.forEach(([, fn]) => fn()); return; }
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        const alvo = alvos.find(([s]) => e.target.matches(s));
        if (alvo) alvo[1]();
        io.unobserve(e.target);
      }
    }, { rootMargin: '400px 0px' });
    alvos.forEach(([s]) => { const el = $(s); if (el) io.observe(el); });
  }

  function cliques() {
    document.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-galeria],[data-quarto],[data-experiencia],[data-beneficio],[data-info],[data-categoria],[data-local],[data-como-chegar]');
      if (!alvo) return;
      const ds = alvo.dataset;
      if (ds.galeria) lbAbrir(ds.galeria, +ds.indice || 0);
      else if (ds.quarto) modalQuarto(ds.quarto);
      else if (ds.experiencia) modalExperiencia(ds.experiencia);
      else if (ds.beneficio) modalBeneficio(ds.beneficio);
      else if (ds.info) modalInfo(ds.info);
      else if (ds.categoria) selecionarCategoria(ds.categoria);
      else if (ds.local) selecionarLocal(ds.local);
      else if (ds.comoChegar) selecionarLocal(ds.comoChegar, true);
    });
  }

  function montar() {
    aplicarTema();
    for (const sec of $$('[data-secao]')) {
      const chave = sec.dataset.secao;
      const dados = D[chave];
      if (!dados || !secoes[chave]) { sec.remove(); continue; }
      if (chave === 'proximidades' && !lista(dados.locais).length) { sec.remove(); continue; }
      if (chave === 'galeria' && !lista(dados.fotos).length) { sec.remove(); continue; } // galeria vazia não aparece
      sec.innerHTML = secoes[chave](dados);
    }
    $('#rodape').innerHTML = rodape();
    montarTopo();
    cliques();
    const primeira = $('#proximidades .chip');
    if (primeira) selecionarCategoria(primeira.dataset.categoria);
    observarRevelar();
    observarMapas();
    document.body.classList.add('pronto');
  }

  fetch('data.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((json) => { D = json; montar(); })
    .catch((err) => {
      console.error(err);
      // Aberto com dois cliques (file://): o navegador bloqueia a leitura do data.json
      if (location.protocol === 'file:') {
        const pasta = decodeURIComponent(location.pathname.split('/').slice(-2, -1)[0] || '');
        $('#conteudo').innerHTML = `<div class="erro container">
          <h1>Para ver o site no computador</h1>
          <p>O navegador não deixa um site aberto com dois cliques ler o <code>data.json</code>.
          Publicado na internet, ele funciona normalmente.</p>
          <p><b>Opção 1 — sempre atualizado:</b> volte à pasta <b>Sites Pousadas EcoVip</b> e dê dois cliques em
          <b>Abrir sites.bat</b>.</p>
          <p><b>Opção 2 — visualização rápida:</b> <a href="../Visualizar/${esc(pasta)}.html">abrir a visualização desta pousada</a>
          (pode estar desatualizada se você mudou algo depois).</p>
        </div>`;
        return;
      }
      $('#conteudo').innerHTML = `<div class="erro container">
        <h1>Não foi possível carregar o conteúdo.</h1>
        <p>Verifique se o arquivo <code>data.json</code> existe e é um JSON válido
        (cole o conteúdo em jsonlint.com para achar o erro).</p>
      </div>`;
    });
})();
