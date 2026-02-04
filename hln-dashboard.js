// HLN Dashboard - Combined Author/Editor Dashboard
// Global state
let currentRole = null;
let currentPage = 'today';

// User data per role
const userData = {
    author: {
        name: 'Sarah De Vries',
        initials: 'SV',
        role: 'Auteur',
        subtitle: 'Auteur Dashboard'
    },
    editor: {
        name: 'Dimitri Antonissen',
        initials: 'DA',
        role: 'Hoofdredacteur',
        subtitle: 'Redactie Dashboard'
    }
};

// Article data
const articleData = {
    'anderlecht': {
        category: 'Nieuws',
        title: 'Jongen (14) geeft zichzelf aan nadat tiener (15) in brand werd gestoken in Anderlecht',
        views: '523.450',
        readtime: '3m 45s',
        comments: '3.287',
        shares: '12.4K',
        readpct: 72,
        male: 48,
        female: 52,
        ages: [22, 26, 21, 18, 13],
        score: 15,
        rating: 'Uitstekend',
        summary: 'Dit artikel presteert <span class="performance-highlight">ver boven verwachting</span>. Met 523K weergaven is het de best presterende content vandaag.',
        author: 'Sarah De Vries'
    },
    'epstein': {
        category: 'Nieuws',
        title: 'Bill en Hillary Clinton zullen toch getuigen in Epstein-onderzoek',
        views: '387.230',
        readtime: '5m 12s',
        comments: '2.156',
        shares: '18.7K',
        readpct: 64,
        male: 52,
        female: 48,
        ages: [15, 24, 28, 20, 13],
        score: 14,
        rating: 'Zeer goed',
        summary: 'Sterke prestatie met <span class="performance-highlight">387K weergaven</span>. Internationaal thema met lokale link werkt goed.',
        author: 'Jan Peeters'
    },
    'nestle': {
        category: 'Nieuws',
        title: 'Baby besmet door Nestle-babyvoeding in Vlaanderen',
        views: '298.670',
        readtime: '4m 20s',
        comments: '1.432',
        shares: '6.2K',
        readpct: 78,
        male: 35,
        female: 65,
        ages: [12, 38, 32, 12, 6],
        score: 13,
        rating: 'Goed',
        summary: 'Solide prestatie met <span class="performance-highlight">hoog uitleespercentage (78%)</span>.',
        author: 'Sarah De Vries'
    },
    'vogelgriep': {
        category: 'Regio West-Vlaanderen',
        title: 'Vogelgriep H5 vastgesteld op pluimveebedrijf in Alveringem',
        views: '187.450',
        readtime: '2m 55s',
        comments: '567',
        shares: '2.1K',
        readpct: 81,
        male: 58,
        female: 42,
        ages: [8, 18, 26, 28, 20],
        score: 11,
        rating: 'Voldoende',
        summary: 'Regionaal nieuws met <span class="performance-highlight">uitstekend uitleespercentage (81%)</span>.',
        author: 'Marie Claes'
    },
    'begroting': {
        category: 'Nieuws',
        title: 'Federale begroting ontspoort: regering-De Wever haalt doelstellingen niet',
        views: '156.890',
        readtime: '6m 30s',
        comments: '1.876',
        shares: '4.8K',
        readpct: 58,
        male: 62,
        female: 38,
        ages: [10, 22, 28, 24, 16],
        score: 10,
        rating: 'Voldoende',
        summary: 'Politiek nieuws met <span class="performance-highlight">lange leestijd (6m30s)</span>.',
        author: 'Sarah De Vries'
    }
};

// AI responses
const aiResponses = {
    default: [
        "Op basis van de huidige data zie ik dat Sport vandaag 34% boven budget presteert.",
        "Je HLN+ sectie presteert goed met lifestyle content.",
        "Regio Limburg blijft achter. Ik raad aan om de succesvolle formules van Antwerpen toe te passen.",
        "De piekuren vandaag liggen tussen 12:00 en 14:00."
    ],
    author: [
        "Je artikel over Anderlecht presteert uitstekend met 523K views.",
        "Je gemiddelde uitleespercentage deze week is 71%, dat is 8% boven het redactiegemiddelde.",
        "Je artikelen over nieuws scoren het beste. Overweeg meer focus op dit onderwerp."
    ],
    sport: "Sport presteert vandaag uitstekend met 6,2M pageviews (+34% vs budget).",
    showbizz: "Showbizz scoort +8% boven budget.",
    limburg: "Regio Limburg presteert al 4 weken onder budget (-15% vandaag).",
    budget: "Deze week scoren we +4,6% boven budget op bezoekers."
};

// Role selection
function selectRole(role) {
    currentRole = role;
    document.getElementById('role-selection').classList.add('hidden');
    document.getElementById('app-container').classList.add('visible');

    updateUIForRole();
    renderPage(currentPage);
    setupNavigation();
    startLiveUpdates();
}

function switchRole() {
    document.getElementById('role-selection').classList.remove('hidden');
    document.getElementById('app-container').classList.remove('visible');
    currentRole = null;
}

function updateUIForRole() {
    const user = userData[currentRole];

    // Update sidebar
    document.getElementById('sidebar-subtitle').textContent = user.subtitle;
    document.getElementById('user-avatar').textContent = user.initials;
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-role-label').textContent = user.role;

    // Show/hide editor-only elements
    const editorElements = document.querySelectorAll('.editor-only, .editor-only-mobile');
    editorElements.forEach(el => {
        el.style.display = currentRole === 'editor' ? '' : 'none';
    });
}

// Page rendering
function renderPage(page) {
    currentPage = page;
    const mainContent = document.getElementById('main-content');

    if (currentRole === 'author') {
        mainContent.innerHTML = renderAuthorPage(page);
    } else {
        mainContent.innerHTML = renderEditorPage(page);
    }

    // Setup event listeners after rendering
    setupArticleClicks();
    setupAIInput();
}

function renderAuthorPage(page) {
    const user = userData.author;

    if (page === 'today') {
        return `
            <div class="page active" id="page-today">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Hallo ${user.name.split(' ')[0]}</h1>
                            <p class="greeting-subtitle">Bekijk hoe je artikelen vandaag presteren</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                    <div class="date-badge">
                        <span class="live-indicator"></span>
                        <span>maandag 3 februari 2026</span>
                        <span>•</span>
                        <span id="current-time">14:32</span>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Persoonlijke analyse</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Je artikel over het Anderlecht-incident is trending</strong> met 523K views.
                            Je gemiddelde score vandaag is 12.7/17, wat <strong>boven het redactiegemiddelde</strong> ligt.
                            Tip: artikelen met quotes in de titel scoren bij jou 23% beter.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag over je artikelen..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="author-score-card">
                    <div class="author-score-label">Jouw Gemiddelde Score Vandaag</div>
                    <div class="author-score-value">12.7</div>
                    <div class="author-score-rating">+1.2 vs vorige week</div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Jouw Artikelweergaven</div>
                            <div class="stat-icon">👁</div>
                        </div>
                        <div class="stat-value">978K</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+18% vs vorige week</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Gem. Leestijd</div>
                            <div class="stat-icon">⏱</div>
                        </div>
                        <div class="stat-value">4m 12s</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+8% vs redactie gem.</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Gepubliceerd Vandaag</div>
                            <div class="stat-icon">📝</div>
                        </div>
                        <div class="stat-value">3</div>
                        <div class="stat-comparison">
                            <div class="comparison-item neutral">= normaal daggemiddelde</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Jouw Artikels Vandaag</h2>
                    <span class="section-badge">3 gepubliceerd</span>
                </div>

                <div class="featured-article" onclick="openModal('anderlecht')">
                    <div class="featured-article-image">
                        <div class="featured-category">Nieuws</div>
                        <div class="featured-rank gold">1</div>
                    </div>
                    <div class="featured-article-content">
                        <div class="featured-article-title">Jongen (14) geeft zichzelf aan nadat tiener (15) in brand werd gestoken in Anderlecht</div>
                        <div class="article-stats">
                            <div class="article-stat">
                                <span>👁</span>
                                <span class="article-stat-value">523.450</span>
                                <span>views</span>
                            </div>
                            <div class="article-stat">
                                <span>⏱</span>
                                <span class="article-stat-value">3m 45s</span>
                            </div>
                            <div class="article-stat">
                                <span>⭐</span>
                                <span class="article-stat-value">15/17</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="articles-list">
                    <div class="article-item" onclick="openModal('nestle')">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Baby besmet door Nestle-babyvoeding in Vlaanderen</div>
                            <div class="article-meta">
                                <span>👁 298.670</span>
                                <span>⭐ 13/17</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item" onclick="openModal('begroting')">
                        <div class="article-rank">3</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Federale begroting ontspoort: regering-De Wever haalt doelstellingen niet</div>
                            <div class="article-meta">
                                <span>👁 156.890</span>
                                <span>⭐ 10/17</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (page === 'yesterday') {
        return `
            <div class="page active">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Gisteren</h1>
                            <p class="greeting-subtitle">Jouw prestaties van zondag 2 februari</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Analyse van gisteren</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Je weekend-artikel over de tiener die zijn gezin redde</strong> was je beste prestatie ooit qua social shares (24.5K).
                            Feel-good verhalen scoren bij jou gemiddeld <strong>40% beter</strong> dan hard nieuws.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Jouw Artikelweergaven</div>
                            <div class="stat-icon">👁</div>
                        </div>
                        <div class="stat-value">645K</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+32% vs normaal weekend</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Gem. Score</div>
                            <div class="stat-icon">⭐</div>
                        </div>
                        <div class="stat-value">14.2</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">Uitstekend</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Gepubliceerd</div>
                            <div class="stat-icon">📝</div>
                        </div>
                        <div class="stat-value">2</div>
                        <div class="stat-comparison">
                            <div class="comparison-item neutral">Weekend dienst</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Jouw Artikels Gisteren</h2>
                </div>

                <div class="articles-list">
                    <div class="article-item">
                        <div class="article-rank">1</div>
                        <div class="article-content">
                            <div class="article-category">Binnenland</div>
                            <div class="article-title">Tiener (13) zwemt vier uur door woeste zee en redt zo zijn hele gezin</div>
                            <div class="article-meta">
                                <span>👁 398.120</span>
                                <span>⭐ 16/17</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Regio</div>
                            <div class="article-title">Grote brand verwoest loods in Gentse haven</div>
                            <div class="article-meta">
                                <span>👁 247.340</span>
                                <span>⭐ 12/17</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (page === 'week') {
        return `
            <div class="page active">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Deze Week</h1>
                            <p class="greeting-subtitle">Jouw prestaties 27 jan - 2 feb</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Weekanalyse</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Je beste dag was woensdag</strong> met 1.2M views op 4 artikelen.
                            Je artikelen met quotes in de titel presteren <strong>23% beter</strong>.
                            Tip: publiceer rond 12:00 - dan is jouw doelgroep het meest actief.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="author-score-card">
                    <div class="author-score-label">Weekgemiddelde Score</div>
                    <div class="author-score-value">13.4</div>
                    <div class="author-score-rating">Top 15% van de redactie</div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Totaal Weergaven</div>
                            <div class="stat-icon">👁</div>
                        </div>
                        <div class="stat-value">4.2M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+24% vs vorige week</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Artikelen</div>
                            <div class="stat-icon">📝</div>
                        </div>
                        <div class="stat-value">18</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+3 vs target</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Social Shares</div>
                            <div class="stat-icon">📱</div>
                        </div>
                        <div class="stat-value">42.3K</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">Top performer</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Top 5 Deze Week</h2>
                </div>

                <div class="articles-list">
                    <div class="article-item">
                        <div class="article-rank">1</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Jongen (14) geeft zichzelf aan - Anderlecht incident</div>
                            <div class="article-meta">
                                <span>👁 523.450</span>
                                <span>⭐ 15/17</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Binnenland</div>
                            <div class="article-title">Tiener zwemt vier uur door woeste zee</div>
                            <div class="article-meta">
                                <span>👁 398.120</span>
                                <span>⭐ 16/17</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">3</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Baby besmet door Nestle-babyvoeding</div>
                            <div class="article-meta">
                                <span>👁 298.670</span>
                                <span>⭐ 13/17</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    return '<div class="page active"><p>Pagina niet gevonden</p></div>';
}

function renderEditorPage(page) {
    const user = userData.editor;

    if (page === 'today') {
        return `
            <div class="page active" id="page-today">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Goedemiddag ${user.name.split(' ')[0]}</h1>
                            <p class="greeting-subtitle">Hier zie je hoe het vandaag met HLN loopt</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                    <div class="date-badge">
                        <span class="live-indicator"></span>
                        <span>maandag 3 februari 2026</span>
                        <span>•</span>
                        <span id="current-time">14:32</span>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Ik analyseer continu je data</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Het Anderlecht-incident domineert met 523K views</strong> en genereert veel engagement (3.2K reacties).
                            Daarom stel ik voor dat je <strong>een duiding-stuk laat maken over jeugdcriminaliteit in Brussel</strong>.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag aan je AI assistent..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Bezoekers</div>
                            <div class="stat-icon">👥</div>
                        </div>
                        <div class="stat-value">2,48M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+3,2% vs budget</div>
                            <div class="comparison-item positive">+5,1% vs 8w gem.</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Pageviews</div>
                            <div class="stat-icon">📊</div>
                        </div>
                        <div class="stat-value">24,6M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+1,8% vs budget</div>
                            <div class="comparison-item positive">+4,2% vs 8w gem.</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Gepubliceerde Artikels</div>
                            <div class="stat-icon">📰</div>
                        </div>
                        <div class="stat-value">287</div>
                        <div class="stat-comparison">
                            <div class="comparison-item neutral">= budget (285)</div>
                            <div class="comparison-item positive">+12 vs 8w gem.</div>
                        </div>
                    </div>
                </div>

                <div class="subsections-card">
                    <div class="subsections-title">📂 Sectie Artikelweergaven Vandaag</div>
                    <div class="subsections-grid">
                        <div class="subsection-item nieuws">
                            <div class="subsection-name">Nieuws</div>
                            <div class="subsection-value">4,2M</div>
                            <div class="subsection-percent">40% • +5% vs budget</div>
                        </div>
                        <div class="subsection-item regio">
                            <div class="subsection-name">Regio</div>
                            <div class="subsection-value">2,6M</div>
                            <div class="subsection-percent">25% • +3% vs budget</div>
                        </div>
                        <div class="subsection-item sport">
                            <div class="subsection-name">Sport</div>
                            <div class="subsection-value">1,6M</div>
                            <div class="subsection-percent">15% • -2% vs budget</div>
                        </div>
                        <div class="subsection-item showbizz">
                            <div class="subsection-name">Showbizz</div>
                            <div class="subsection-value">1,6M</div>
                            <div class="subsection-percent">15% • +8% vs budget</div>
                        </div>
                        <div class="subsection-item other">
                            <div class="subsection-name">Varia</div>
                            <div class="subsection-value">0,5M</div>
                            <div class="subsection-percent">5% • +1% vs budget</div>
                        </div>
                    </div>
                </div>

                <div class="live-card">
                    <div class="live-header">
                        <div class="live-title">Nu op HLN</div>
                        <div class="live-badge">LIVE</div>
                    </div>
                    <div class="live-number" id="live-users">51.234</div>
                    <div class="live-label">actieve lezers op dit moment</div>
                    <div class="live-breakdown">
                        <div class="breakdown-item">
                            <div class="breakdown-value">62%</div>
                            <div class="breakdown-label">Mobiel</div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-value">31%</div>
                            <div class="breakdown-label">Desktop</div>
                        </div>
                        <div class="breakdown-item">
                            <div class="breakdown-value">7%</div>
                            <div class="breakdown-label">Tablet</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Top Artikels Vandaag</h2>
                    <span class="section-badge">Live ranking</span>
                </div>

                <div class="featured-article" onclick="openModal('anderlecht')">
                    <div class="featured-article-image">
                        <div class="featured-category">Nieuws</div>
                        <div class="featured-rank gold">1</div>
                    </div>
                    <div class="featured-article-content">
                        <div class="featured-article-title">Jongen (14) geeft zichzelf aan nadat tiener (15) in brand werd gestoken in Anderlecht</div>
                        <div class="article-stats">
                            <div class="article-stat"><span>👁</span><span class="article-stat-value">523.450</span><span>views</span></div>
                            <div class="article-stat"><span>⏱</span><span class="article-stat-value">3m 45s</span></div>
                            <div class="article-stat"><span>💬</span><span class="article-stat-value">3.287</span></div>
                        </div>
                    </div>
                </div>

                <div class="articles-list">
                    <div class="article-item" onclick="openModal('epstein')">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Bill en Hillary Clinton zullen toch getuigen in Epstein-onderzoek</div>
                            <div class="article-meta"><span>👁 387.230</span><span>💬 2.156</span></div>
                        </div>
                    </div>
                    <div class="article-item" onclick="openModal('nestle')">
                        <div class="article-rank">3</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Baby besmet door Nestle-babyvoeding in Vlaanderen</div>
                            <div class="article-meta"><span>👁 298.670</span><span>💬 1.432</span></div>
                        </div>
                    </div>
                    <div class="article-item" onclick="openModal('vogelgriep')">
                        <div class="article-rank">4</div>
                        <div class="article-content">
                            <div class="article-category">Regio West-Vlaanderen</div>
                            <div class="article-title">Vogelgriep H5 vastgesteld op pluimveebedrijf in Alveringem</div>
                            <div class="article-meta"><span>👁 187.450</span><span>💬 567</span></div>
                        </div>
                    </div>
                    <div class="article-item" onclick="openModal('begroting')">
                        <div class="article-rank">5</div>
                        <div class="article-content">
                            <div class="article-category">Nieuws</div>
                            <div class="article-title">Federale begroting ontspoort: regering-De Wever haalt doelstellingen niet</div>
                            <div class="article-meta"><span>👁 156.890</span><span>💬 1.876</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (page === 'yesterday') {
        return `
            <div class="page active">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Gisteren</h1>
                            <p class="greeting-subtitle">Overzicht van zondag 2 februari 2026</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Analyse van gisteren</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Zondag scoorde 8% onder budget</strong>, vooral door lagere Sport-traffic.
                            Overweeg <strong>meer focus op Showbizz en Lifestyle</strong> op rustige zondagen.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Bezoekers</div>
                            <div class="stat-icon">👥</div>
                        </div>
                        <div class="stat-value">2,21M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item negative">-8,0% vs budget</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Pageviews</div>
                            <div class="stat-icon">📊</div>
                        </div>
                        <div class="stat-value">21,3M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item negative">-5,4% vs budget</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Gepubliceerde Artikels</div>
                            <div class="stat-icon">📰</div>
                        </div>
                        <div class="stat-value">198</div>
                        <div class="stat-comparison">
                            <div class="comparison-item neutral">Normaal voor zondag</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Top Artikels Gisteren</h2>
                </div>

                <div class="articles-list">
                    <div class="article-item">
                        <div class="article-rank">1</div>
                        <div class="article-content">
                            <div class="article-category">Binnenland</div>
                            <div class="article-title">Tiener (13) zwemt vier uur door woeste zee en redt zo zijn hele gezin</div>
                            <div class="article-meta"><span>👁 398.120</span><span>💬 1.876</span></div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Sport</div>
                            <div class="article-title">Club Brugge wint topper tegen Anderlecht: 2-1</div>
                            <div class="article-meta"><span>👁 287.650</span><span>💬 1.432</span></div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">3</div>
                        <div class="article-content">
                            <div class="article-category">Showbizz</div>
                            <div class="article-title">Netflix-hit De Kraak breekt Belgisch record</div>
                            <div class="article-meta"><span>👁 234.890</span><span>💬 567</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (page === 'week') {
        return `
            <div class="page active">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Deze Week</h1>
                            <p class="greeting-subtitle">27 jan - 2 feb 2026 (daggemiddelden)</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Weekanalyse</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>HLN+ groeit al 3 weken op rij</strong> met +8% vs budget.
                            De succesvolle Plus-formats converteren <strong>23% beter</strong> naar abonnementen.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Stel een vraag..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="stats-grid">
                    <div class="stat-card users">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Bezoekers</div>
                            <div class="stat-icon">👥</div>
                        </div>
                        <div class="stat-value">2,52M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+4,6% vs budget</div>
                        </div>
                    </div>
                    <div class="stat-card pageviews">
                        <div class="stat-header">
                            <div class="stat-label">Daggemiddelde Pageviews</div>
                            <div class="stat-icon">📊</div>
                        </div>
                        <div class="stat-value">25,1M</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+3,2% vs budget</div>
                        </div>
                    </div>
                    <div class="stat-card articles">
                        <div class="stat-header">
                            <div class="stat-label">Artikels/Dag (gem.)</div>
                            <div class="stat-icon">📰</div>
                        </div>
                        <div class="stat-value">276</div>
                        <div class="stat-comparison">
                            <div class="comparison-item positive">+3,4% vs budget</div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Top Artikels Deze Week</h2>
                </div>

                <div class="articles-list">
                    <div class="article-item">
                        <div class="article-rank">1</div>
                        <div class="article-content">
                            <div class="article-category">Sport</div>
                            <div class="article-title">Rode Duivels verslaan Frankrijk met 3-1: Lukaku scoort hattrick</div>
                            <div class="article-meta"><span>👁 1,24M</span><span>💬 4.567</span></div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">2</div>
                        <div class="article-content">
                            <div class="article-category">Binnenland</div>
                            <div class="article-title">Nieuwe regering presenteert begroting</div>
                            <div class="article-meta"><span>👁 876.450</span><span>💬 3.234</span></div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-rank">3</div>
                        <div class="article-content">
                            <div class="article-category">HLN+</div>
                            <div class="article-title">Exclusief interview: Koning Filip over de toekomst</div>
                            <div class="article-meta"><span>👁 654.230</span><span>💬 2.876</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (page === 'sections') {
        return `
            <div class="page active">
                <header class="page-header">
                    <div class="header-top">
                        <div>
                            <h1 class="greeting">Sectie Overzicht</h1>
                            <p class="greeting-subtitle">Prestaties per redactie (daggemiddelden)</p>
                        </div>
                        <div class="user-avatar-small" onclick="switchRole()">${user.initials}</div>
                    </div>
                </header>

                <div class="ai-assistant">
                    <div class="ai-header">
                        <div class="ai-icon">🤖</div>
                        <div>
                            <div class="ai-title">AI Assistent</div>
                            <div class="ai-subtitle">Sectie-analyse</div>
                        </div>
                    </div>
                    <div class="ai-advice">
                        <div class="ai-advice-label">Het valt me op dat...</div>
                        <div class="ai-advice-text">
                            <strong>Regio Limburg presteert al 4 weken onder budget</strong>.
                            Pas de succesformules van Antwerpen (lokale misdaad, verkeer) toe in Limburg.
                        </div>
                    </div>
                    <div class="ai-prompt-container">
                        <input type="text" class="ai-prompt-input" placeholder="Vraag iets over de secties..." id="ai-input">
                        <button class="ai-prompt-btn" onclick="handleAIPrompt()">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                        </button>
                    </div>
                    <div class="ai-response" id="ai-response">
                        <div class="ai-response-text"></div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Hoofdsecties</h2>
                    <span class="section-badge">Vandaag</span>
                </div>

                <div class="articles-list" style="margin-bottom: 24px;">
                    <div class="article-item" style="border-left: 4px solid var(--accent-primary);">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-primary);">Nieuws</div>
                            <div class="article-title" style="font-size: 15px;">4,2M artikelweergaven • 40% van totaal</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-green);">+5% vs budget</span>
                                <span>124 artikels</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item" style="border-left: 4px solid var(--accent-blue);">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-blue);">Regio Totaal</div>
                            <div class="article-title" style="font-size: 15px;">2,6M artikelweergaven • 25% van totaal</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-green);">+3% vs budget</span>
                                <span>98 artikels</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item" style="border-left: 4px solid var(--accent-green);">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-green);">Sport</div>
                            <div class="article-title" style="font-size: 15px;">1,6M artikelweergaven • 15% van totaal</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-primary);">-2% vs budget</span>
                                <span>42 artikels</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item" style="border-left: 4px solid var(--accent-purple);">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-purple);">Showbizz</div>
                            <div class="article-title" style="font-size: 15px;">1,6M artikelweergaven • 15% van totaal</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-green);">+8% vs budget</span>
                                <span>38 artikels</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-header">
                    <h2 class="section-title">Regio Breakdown</h2>
                </div>

                <div class="articles-list">
                    <div class="article-item">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-green);">Antwerpen</div>
                            <div class="article-title">1,8M pageviews</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-green);">+12% vs budget</span>
                                <span>34 artikels</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-green);">Oost-Vlaanderen</div>
                            <div class="article-title">1,4M pageviews</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-green);">+8% vs budget</span>
                                <span>28 artikels</span>
                            </div>
                        </div>
                    </div>
                    <div class="article-item">
                        <div class="article-content">
                            <div class="article-category" style="color: var(--accent-primary);">Limburg</div>
                            <div class="article-title">0,6M pageviews</div>
                            <div class="article-meta">
                                <span style="color: var(--accent-primary);">-15% vs budget</span>
                                <span>12 artikels</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    return '<div class="page active"><p>Pagina niet gevonden</p></div>';
}

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;

            document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(i => {
                i.classList.remove('active');
                if (i.dataset.page === page) {
                    i.classList.add('active');
                }
            });

            renderPage(page);
            window.scrollTo(0, 0);
        });
    });
}

// Article clicks
function setupArticleClicks() {
    // Already handled via onclick attributes in HTML
}

// Modal functions
function openModal(articleId) {
    const data = articleData[articleId];
    if (!data) return;

    document.getElementById('modal-category').textContent = data.category;
    document.getElementById('modal-title').textContent = data.title;
    document.getElementById('modal-views').textContent = data.views;
    document.getElementById('modal-readtime').textContent = data.readtime;
    document.getElementById('modal-comments').textContent = data.comments;
    document.getElementById('modal-shares').textContent = data.shares;
    document.getElementById('modal-readpct').textContent = data.readpct + '%';
    document.getElementById('modal-readbar').style.width = data.readpct + '%';
    document.getElementById('modal-score').textContent = data.score;
    document.getElementById('modal-score-bar').style.width = (data.score / 17 * 100) + '%';
    document.getElementById('modal-rating').textContent = data.rating;
    document.getElementById('modal-summary').innerHTML = data.summary;
    document.getElementById('modal-male').style.width = data.male + '%';
    document.getElementById('modal-male').textContent = data.male + '%';
    document.getElementById('modal-female').style.width = data.female + '%';
    document.getElementById('modal-female').textContent = data.female + '%';

    data.ages.forEach((age, i) => {
        const el = document.getElementById('modal-age' + (i + 1));
        el.style.width = age + '%';
        el.textContent = age + '%';
    });

    document.getElementById('article-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('article-modal').classList.remove('active');
    document.body.style.overflow = '';
}

// Close modal on overlay click
document.getElementById('article-modal').addEventListener('click', (e) => {
    if (e.target.id === 'article-modal') {
        closeModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// AI handling
function setupAIInput() {
    const input = document.getElementById('ai-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleAIPrompt();
            }
        });
    }
}

function handleAIPrompt() {
    const input = document.getElementById('ai-input');
    const response = document.getElementById('ai-response');
    const responseText = response.querySelector('.ai-response-text');

    if (!input || !input.value.trim()) return;

    const query = input.value.toLowerCase();
    let answer;

    if (currentRole === 'author') {
        answer = aiResponses.author[Math.floor(Math.random() * aiResponses.author.length)];
    } else {
        answer = aiResponses.default[Math.floor(Math.random() * aiResponses.default.length)];
    }

    if (query.includes('sport')) answer = aiResponses.sport;
    else if (query.includes('showbizz')) answer = aiResponses.showbizz;
    else if (query.includes('limburg')) answer = aiResponses.limburg;
    else if (query.includes('budget')) answer = aiResponses.budget;

    responseText.textContent = answer;
    response.classList.add('visible');
    input.value = '';
}

// Live updates
function startLiveUpdates() {
    updateTime();
    setInterval(updateTime, 60000);
    setInterval(updateLiveUsers, 5000);
}

function updateTime() {
    const timeEl = document.getElementById('current-time');
    if (timeEl) {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    }
}

function updateLiveUsers() {
    const liveNumber = document.getElementById('live-users');
    if (liveNumber) {
        const base = 50000;
        const variation = Math.floor(Math.random() * 3000) - 1500;
        liveNumber.textContent = (base + variation).toLocaleString('nl-BE');
    }
}
