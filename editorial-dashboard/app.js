/**
 * Editorial Dashboard - Whoop-style Interactive Dashboard
 * For de Volkskrant editorial team
 */

// ============================================
// FAKE DATA
// ============================================

const authorData = {
    name: 'Thomas van der Berg',
    role: 'Hoofdredacteur Economie',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face'
};

const articlesData = [
    {
        id: 1,
        title: 'De onzichtbare hand achter de huizenmarkt',
        publishDate: '2025-01-28',
        category: 'Economie',
        readTime: 8,
        views: 24850,
        completionRate: 78,
        avgReadTime: 6.2,
        trend: +12,
        sections: [
            { name: 'Intro', readRate: 98, words: 180 },
            { name: 'Analyse', readRate: 85, words: 450 },
            { name: 'Data', readRate: 72, words: 320 },
            { name: 'Impact', readRate: 68, words: 280 },
            { name: 'Conclusie', readRate: 65, words: 150 }
        ],
        dropoffPoints: [
            { position: 35, reason: 'Lange paragraaf zonder tussenkop' },
            { position: 62, reason: 'Technisch jargon' }
        ]
    },
    {
        id: 2,
        title: 'Waarom de rente blijft stijgen: een diepteanalyse',
        publishDate: '2025-01-26',
        category: 'Financiën',
        readTime: 12,
        views: 31200,
        completionRate: 65,
        avgReadTime: 7.8,
        trend: +28,
        sections: [
            { name: 'Intro', readRate: 97, words: 200 },
            { name: 'ECB Beleid', readRate: 78, words: 520 },
            { name: 'Historisch', readRate: 62, words: 480 },
            { name: 'Voorspelling', readRate: 58, words: 350 },
            { name: 'Tips', readRate: 55, words: 180 }
        ],
        dropoffPoints: [
            { position: 28, reason: 'Complex financieel model' },
            { position: 55, reason: 'Gebrek aan visuele elementen' }
        ]
    },
    {
        id: 3,
        title: 'Interview: CEO van ING over de toekomst van bankieren',
        publishDate: '2025-01-24',
        category: 'Interview',
        readTime: 15,
        views: 42100,
        completionRate: 82,
        avgReadTime: 12.3,
        trend: +45,
        sections: [
            { name: 'Intro', readRate: 99, words: 150 },
            { name: 'Achtergrond', readRate: 92, words: 380 },
            { name: 'Digitalisering', readRate: 88, words: 520 },
            { name: 'Duurzaamheid', readRate: 85, words: 450 },
            { name: 'Toekomst', readRate: 80, words: 320 }
        ],
        dropoffPoints: [
            { position: 72, reason: 'Kleine dip bij technische details' }
        ]
    },
    {
        id: 4,
        title: 'Inflatie daalt sneller dan verwacht: wat betekent dit?',
        publishDate: '2025-01-22',
        category: 'Economie',
        readTime: 6,
        views: 18400,
        completionRate: 88,
        avgReadTime: 5.3,
        trend: +8,
        sections: [
            { name: 'Intro', readRate: 99, words: 120 },
            { name: 'Cijfers', readRate: 94, words: 280 },
            { name: 'Analyse', readRate: 90, words: 320 },
            { name: 'Consument', readRate: 86, words: 240 }
        ],
        dropoffPoints: []
    },
    {
        id: 5,
        title: 'De stille revolutie in de pensioenwereld',
        publishDate: '2025-01-20',
        category: 'Pensioen',
        readTime: 10,
        views: 15600,
        completionRate: 71,
        avgReadTime: 7.1,
        trend: -3,
        sections: [
            { name: 'Intro', readRate: 96, words: 160 },
            { name: 'Nieuwe wet', readRate: 82, words: 420 },
            { name: 'Impact', readRate: 70, words: 380 },
            { name: 'Actie', readRate: 68, words: 280 }
        ],
        dropoffPoints: [
            { position: 42, reason: 'Juridische terminologie' }
        ]
    },
    {
        id: 6,
        title: 'Crypto in 2025: renaissance of requiem?',
        publishDate: '2025-01-18',
        category: 'Technologie',
        readTime: 9,
        views: 28900,
        completionRate: 76,
        avgReadTime: 6.8,
        trend: +19,
        sections: [
            { name: 'Intro', readRate: 98, words: 140 },
            { name: 'Markt', readRate: 88, words: 360 },
            { name: 'Regulering', readRate: 75, words: 420 },
            { name: 'Outlook', readRate: 72, words: 280 }
        ],
        dropoffPoints: [
            { position: 48, reason: 'Technische blockchain uitleg' }
        ]
    }
];

const weeklyStats = {
    totalViews: 161050,
    avgCompletion: 73,
    articlesPublished: 6,
    totalWords: 8420,
    avgReadTime: 7.6,
    reachGrowth: 34,
    topPerformer: 'Interview: CEO van ING'
};

const trendsData = {
    labels: ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'],
    views: [12400, 18200, 24100, 31500, 28900, 22300, 23650],
    completion: [68, 72, 75, 82, 78, 71, 73]
};

const aiInsights = [
    "Je interview met de ING-CEO scoorde 45% boven gemiddeld. Persoonlijke verhalen werken!",
    "Artikelen onder 8 minuten leestijd worden 23% vaker uitgelezen.",
    "Je economie-analyses trekken 34% meer lezers dan vorige maand.",
    "Tip: je stukken met bullet points hebben 18% hogere engagement.",
    "Donderdag was je beste dag qua bereik. Plan je belangrijkste artikelen dan!"
];

const flowInsights = [
    "Je langere paragrafen (>200 woorden) zorgen voor 23% meer afhakers. Probeer meer tussenkopjes te gebruiken.",
    "Lezers haken af bij technisch jargon. Overweeg een 'in het kort' box toe te voegen.",
    "Dit artikel scoort uitstekend! De persoonlijke quotes houden lezers geboeid tot het einde."
];

// ============================================
// STATE
// ============================================

let currentTab = 'recent';
let currentFlowArticle = 0;
let animationsTriggered = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initSVGGradients();
    initHeader();
    initAIHero();
    initScoreCards();
    initArticlesList();
    initFlowAnalysis();
    initTrendsChart();
    initModal();
    initDateSelector();

    // Trigger animations on scroll
    observeAnimations();
});

// ============================================
// SVG GRADIENTS
// ============================================

function initSVGGradients() {
    const svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgDefs.setAttribute('class', 'svg-defs');
    svgDefs.innerHTML = `
        <defs>
            <linearGradient id="gradient-green" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#00FF94"/>
                <stop offset="100%" style="stop-color:#00D68F"/>
            </linearGradient>
            <linearGradient id="gradient-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#00F0FF"/>
                <stop offset="100%" style="stop-color:#00D4AA"/>
            </linearGradient>
            <linearGradient id="gradient-purple" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#9D4EDD"/>
                <stop offset="100%" style="stop-color:#7B2CBF"/>
            </linearGradient>
            <linearGradient id="gradient-blue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#3A86FF"/>
                <stop offset="100%" style="stop-color:#0066FF"/>
            </linearGradient>
        </defs>
    `;
    document.body.appendChild(svgDefs);
}

// ============================================
// HEADER
// ============================================

function initHeader() {
    // Already set in HTML, but could be dynamic
}

// ============================================
// AI HERO
// ============================================

function initAIHero() {
    const insightText = document.getElementById('ai-insight-text');
    const randomInsight = aiInsights[Math.floor(Math.random() * aiInsights.length)];

    // Typewriter effect
    typeWriter(insightText, randomInsight, 30);
}

function typeWriter(element, text, speed) {
    let i = 0;
    element.textContent = '';

    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }

    setTimeout(type, 500); // Delay start
}

// ============================================
// SCORE CARDS
// ============================================

function initScoreCards() {
    // Delay animations slightly for visual effect
    setTimeout(() => {
        animateScoreRing();
        animateStrainBar();
        animateReachNumber();
        animateReachChart();
    }, 300);
}

function animateScoreRing() {
    const ring = document.getElementById('score-ring');
    const number = document.getElementById('score-number');
    const targetValue = weeklyStats.avgCompletion;

    // Calculate stroke offset (326.73 is full circumference)
    const circumference = 326.73;
    const offset = circumference - (targetValue / 100) * circumference;

    ring.style.strokeDashoffset = offset;

    // Animate number
    animateNumber(number, 0, targetValue, 1500);
}

function animateStrainBar() {
    const bar = document.getElementById('strain-bar');
    const articlesEl = document.getElementById('articles-count');
    const wordsEl = document.getElementById('words-count');
    const avgTimeEl = document.getElementById('avg-time');

    // Animate bar (representing productivity level)
    const productivity = (weeklyStats.articlesPublished / 10) * 100; // Assume 10 is max
    bar.style.width = `${Math.min(productivity * 1.5, 100)}%`;

    // Animate numbers
    animateNumber(articlesEl, 0, weeklyStats.articlesPublished, 1000);
    animateNumber(wordsEl, 0, Math.round(weeklyStats.totalWords / 1000), 1000, 'k');
    animateNumber(avgTimeEl, 0, weeklyStats.avgReadTime, 1000, '', 1);
}

function animateReachNumber() {
    const reachEl = document.getElementById('reach-number');
    animateNumber(reachEl, 0, weeklyStats.totalViews, 2000, '', 0, true);
}

function animateReachChart() {
    const container = document.getElementById('reach-chart');
    const maxViews = Math.max(...trendsData.views);

    trendsData.views.forEach((views, index) => {
        const bar = document.createElement('div');
        bar.className = 'reach-bar';
        bar.style.height = '0px';
        container.appendChild(bar);

        setTimeout(() => {
            bar.style.height = `${(views / maxViews) * 60}px`;
        }, index * 100);
    });
}

function animateNumber(element, start, end, duration, suffix = '', decimals = 0, format = false) {
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = start + (end - start) * easeOut;

        let displayValue = decimals > 0 ? current.toFixed(decimals) : Math.round(current);

        if (format && displayValue >= 1000) {
            displayValue = new Intl.NumberFormat('nl-NL').format(Math.round(displayValue));
        }

        element.textContent = displayValue + suffix;

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

// ============================================
// ARTICLES LIST
// ============================================

function initArticlesList() {
    renderArticles(getArticlesByTab(currentTab));
    initTabSwitching();
}

function getArticlesByTab(tab) {
    const articles = [...articlesData];

    switch (tab) {
        case 'popular':
            return articles.sort((a, b) => b.views - a.views);
        case 'engagement':
            return articles.sort((a, b) => b.completionRate - a.completionRate);
        default: // recent
            return articles.sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
    }
}

function renderArticles(articles) {
    const container = document.getElementById('articles-list');
    container.innerHTML = '';

    articles.forEach((article, index) => {
        const item = document.createElement('div');
        item.className = 'article-item';
        item.style.animationDelay = `${index * 0.1}s`;
        item.onclick = () => openArticleModal(article);

        const trendClass = article.trend >= 0 ? 'up' : 'down';
        const trendIcon = article.trend >= 0 ? '↑' : '↓';

        item.innerHTML = `
            <div class="article-info">
                <div class="article-title">${article.title}</div>
                <div class="article-meta">
                    <span>${formatDate(article.publishDate)}</span>
                    <span>${article.category}</span>
                    <span>${article.readTime} min leestijd</span>
                </div>
            </div>
            <div class="article-stat">
                <span class="stat-value cyan">${formatNumber(article.views)}</span>
                <span class="stat-label">Views</span>
            </div>
            <div class="article-stat">
                <span class="stat-value green">${article.completionRate}%</span>
                <span class="stat-label">Uitgelezen</span>
            </div>
            <div class="article-stat">
                <span class="stat-value purple">${article.avgReadTime}m</span>
                <span class="stat-label">Gem. tijd</span>
            </div>
            <div class="article-trend ${trendClass}">
                ${trendIcon} ${Math.abs(article.trend)}%
            </div>
        `;

        container.appendChild(item);
    });
}

function initTabSwitching() {
    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            currentTab = tab.dataset.tab;
            renderArticles(getArticlesByTab(currentTab));
        });
    });
}

// ============================================
// FLOW ANALYSIS
// ============================================

function initFlowAnalysis() {
    const select = document.getElementById('flow-article-select');

    // Populate select
    select.innerHTML = articlesData.slice(0, 3).map((article, index) =>
        `<option value="${index}">${article.title}</option>`
    ).join('');

    select.addEventListener('change', (e) => {
        currentFlowArticle = parseInt(e.target.value);
        updateFlowVisualization();
    });

    updateFlowVisualization();
}

function updateFlowVisualization() {
    const article = articlesData[currentFlowArticle];
    const flowBar = document.getElementById('flow-bar');
    const flowMarkers = document.getElementById('flow-markers');
    const insightText = document.getElementById('flow-insight-text');

    // Build flow bar segments
    const totalWords = article.sections.reduce((sum, s) => sum + s.words, 0);

    flowBar.innerHTML = article.sections.map((section, index) => {
        const width = (section.words / totalWords) * 100;
        const opacity = section.readRate / 100;
        const colors = ['#00F0FF', '#00D4AA', '#3A86FF', '#9D4EDD', '#7B2CBF'];

        return `
            <div class="flow-segment" style="
                width: ${width}%;
                background: ${colors[index % colors.length]};
                opacity: ${0.4 + opacity * 0.6};
            ">
                <span class="segment-label">${section.name}</span>
            </div>
        `;
    }).join('');

    // Flow markers
    flowMarkers.innerHTML = `
        <span class="flow-marker">0%</span>
        <span class="flow-marker">25%</span>
        <span class="flow-marker">50%</span>
        <span class="flow-marker">75%</span>
        <span class="flow-marker">100%</span>
    `;

    // Update insight
    insightText.innerHTML = `<strong>AI Tip:</strong> ${flowInsights[currentFlowArticle % flowInsights.length]}`;

    // Update rings
    updateFlowRings(article);
}

function updateFlowRings(article) {
    const sections = article.sections;
    const introRate = sections[0]?.readRate || 0;
    const middleRate = sections[Math.floor(sections.length / 2)]?.readRate || 0;
    const endRate = sections[sections.length - 1]?.readRate || 0;

    // Update displayed values
    const valueElements = document.querySelectorAll('.flow-stat-value');
    if (valueElements.length >= 3) {
        valueElements[0].textContent = `${introRate}%`;
        valueElements[1].textContent = `${middleRate}%`;
        valueElements[2].textContent = `${endRate}%`;
    }
}

// ============================================
// TRENDS CHART
// ============================================

function initTrendsChart() {
    const canvas = document.getElementById('trends-canvas');
    const ctx = canvas.getContext('2d');
    const labelsContainer = document.getElementById('trends-labels');

    // Set canvas size
    const container = canvas.parentElement;
    canvas.width = container.offsetWidth * 2;
    canvas.height = 400;
    ctx.scale(2, 2); // For retina displays

    const width = container.offsetWidth;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 20, left: 40 };

    // Add labels
    labelsContainer.innerHTML = trendsData.labels.map(label =>
        `<span class="trend-label">${label}</span>`
    ).join('');

    // Draw chart with animation
    animateTrendsChart(ctx, width, height, padding);
}

function animateTrendsChart(ctx, width, height, padding) {
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxViews = Math.max(...trendsData.views) * 1.1;
    const pointsViews = trendsData.views.map((v, i) => ({
        x: padding.left + (i / (trendsData.views.length - 1)) * chartWidth,
        y: padding.top + chartHeight - (v / maxViews) * chartHeight
    }));

    const pointsCompletion = trendsData.completion.map((c, i) => ({
        x: padding.left + (i / (trendsData.completion.length - 1)) * chartWidth,
        y: padding.top + chartHeight - (c / 100) * chartHeight
    }));

    let progress = 0;
    const duration = 1500;
    const startTime = performance.now();

    function draw(currentTime) {
        const elapsed = currentTime - startTime;
        progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        ctx.clearRect(0, 0, width, height);

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;

        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (i / 4) * chartHeight;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }

        // Draw views line
        drawAnimatedLine(ctx, pointsViews, easeProgress, '#00F0FF', 'rgba(0, 240, 255, 0.1)');

        // Draw completion line
        drawAnimatedLine(ctx, pointsCompletion, easeProgress, '#9D4EDD', 'rgba(157, 78, 221, 0.1)');

        // Draw points
        if (progress === 1) {
            drawPoints(ctx, pointsViews, '#00F0FF');
            drawPoints(ctx, pointsCompletion, '#9D4EDD');
        }

        if (progress < 1) {
            requestAnimationFrame(draw);
        }
    }

    requestAnimationFrame(draw);
}

function drawAnimatedLine(ctx, points, progress, color, fillColor) {
    const visiblePoints = Math.ceil(points.length * progress);

    if (visiblePoints < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < visiblePoints; i++) {
        const xc = (points[i - 1].x + points[i].x) / 2;
        const yc = (points[i - 1].y + points[i].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
    }

    // Last visible point
    if (visiblePoints <= points.length) {
        const lastIndex = visiblePoints - 1;
        ctx.lineTo(points[lastIndex].x, points[lastIndex].y);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill area
    if (progress === 1) {
        ctx.lineTo(points[points.length - 1].x, 180);
        ctx.lineTo(points[0].x, 180);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
}

function drawPoints(ctx, points, color) {
    points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0a0f';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

// ============================================
// MODAL
// ============================================

function initModal() {
    const modal = document.getElementById('article-modal');
    const closeBtn = document.getElementById('modal-close');

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

function openArticleModal(article) {
    const modal = document.getElementById('article-modal');
    const body = document.getElementById('modal-body');

    const flowColors = ['#00F0FF', '#00D4AA', '#3A86FF', '#9D4EDD', '#7B2CBF'];

    body.innerHTML = `
        <div class="modal-header">
            <h3 class="modal-title">${article.title}</h3>
            <div class="modal-meta">
                <span>📅 ${formatDate(article.publishDate)}</span>
                <span>📁 ${article.category}</span>
                <span>⏱️ ${article.readTime} min leestijd</span>
            </div>
        </div>

        <div class="modal-stats">
            <div class="modal-stat">
                <div class="modal-stat-value" style="color: var(--accent-cyan)">
                    ${formatNumber(article.views)}
                </div>
                <div class="modal-stat-label">Weergaven</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-value" style="color: var(--accent-green)">
                    ${article.completionRate}%
                </div>
                <div class="modal-stat-label">Uitgelezen</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-value" style="color: var(--accent-purple)">
                    ${article.avgReadTime}m
                </div>
                <div class="modal-stat-label">Gem. leestijd</div>
            </div>
            <div class="modal-stat">
                <div class="modal-stat-value" style="color: ${article.trend >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
                    ${article.trend >= 0 ? '+' : ''}${article.trend}%
                </div>
                <div class="modal-stat-label">Trend</div>
            </div>
        </div>

        <div class="modal-section">
            <h4>Leesflow per sectie</h4>
            <div class="reading-flow-mini">
                ${article.sections.map((section, i) => `
                    <div class="flow-mini-segment" style="
                        flex: ${section.words};
                        background: ${flowColors[i % flowColors.length]};
                        opacity: ${0.3 + (section.readRate / 100) * 0.7};
                    " title="${section.name}: ${section.readRate}% gelezen"></div>
                `).join('')}
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted);">
                ${article.sections.map(s => `<span>${s.name}</span>`).join('')}
            </div>
        </div>

        ${article.dropoffPoints.length > 0 ? `
            <div class="modal-section">
                <h4>Afhaakmomenten</h4>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    ${article.dropoffPoints.map(point => `
                        <div style="
                            display: flex;
                            align-items: center;
                            gap: 1rem;
                            padding: 0.75rem;
                            background: rgba(255, 71, 87, 0.1);
                            border-radius: var(--radius-sm);
                            border-left: 3px solid var(--accent-red);
                        ">
                            <span style="font-weight: 600; color: var(--accent-red);">${point.position}%</span>
                            <span style="color: var(--text-secondary); font-size: 0.9rem;">${point.reason}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : `
            <div class="modal-section">
                <div style="
                    padding: 1rem;
                    background: rgba(0, 255, 148, 0.1);
                    border-radius: var(--radius-md);
                    border-left: 3px solid var(--accent-green);
                    color: var(--text-secondary);
                ">
                    ✨ Uitstekend! Dit artikel heeft geen significante afhaakmomenten.
                </div>
            </div>
        `}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    const modal = document.getElementById('article-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ============================================
// DATE SELECTOR
// ============================================

function initDateSelector() {
    const buttons = document.querySelectorAll('.date-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Could trigger data refresh here
            // For POC, just visual feedback
        });
    });
}

// ============================================
// SCROLL ANIMATIONS
// ============================================

function observeAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.stat-card, .analytics-section, .flow-section, .trends-section')
        .forEach(el => observer.observe(el));
}

// ============================================
// UTILITIES
// ============================================

function formatDate(dateString) {
    const date = new Date(dateString);
    const options = { day: 'numeric', month: 'short' };
    return date.toLocaleDateString('nl-NL', options);
}

function formatNumber(num) {
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace('.', ',') + 'k';
    }
    return num.toString();
}

// ============================================
// WINDOW RESIZE
// ============================================

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Redraw trends chart on resize
        initTrendsChart();
    }, 250);
});
