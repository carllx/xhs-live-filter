// ==UserScript==
// @name         xhs-live-filter
// @namespace    https://github.com/carllx/xhs-live-filter
// @version      0.1.1
// @description  小红书直播广场智能过滤器
// @author       carllx
// @match        https://www.xiaohongshu.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      xiaohongshu.com
// @connect      edith.xiaohongshu.com
// @updateURL    https://raw.githubusercontent.com/carllx/xhs-live-filter/main/dist/xhs-live-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/carllx/xhs-live-filter/main/dist/xhs-live-filter.user.js
// @run-at       document-idle
// ==/UserScript==

"use strict";
(() => {
  // src/domain/evaluation.ts
  function matchContent(keyword, title, nickname) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) {
      return true;
    }
    const targetTitle = (title || "").toLowerCase();
    const targetNickname = (nickname || "").toLowerCase();
    return targetTitle.includes(normalizedKeyword) || targetNickname.includes(normalizedKeyword);
  }
  function evaluate(facts, policy) {
    if (facts.gender !== "unknown" && !policy.allowedGenders.includes(facts.gender)) {
      return {
        status: "EXCLUDED",
        regionPriority: 0,
        reason: `\u6027\u522B\u4E0D\u5339\u914D (${facts.gender})`
      };
    }
    let regionPriority = 0;
    if (facts.region !== "unknown" && policy.preferredRegions.includes(facts.region)) {
      regionPriority = 1;
    }
    if (regionPriority > 0) {
      return {
        status: "TARGET",
        regionPriority
      };
    }
    return {
      status: "CANDIDATE",
      regionPriority: 0
    };
  }

  // src/domain/facts.ts
  function createUnknownFacts(userId) {
    return {
      userId,
      rawGender: void 0,
      gender: "unknown",
      region: "unknown",
      age: "unknown",
      enriched: false
    };
  }

  // src/domain/gender-calibration.ts
  var GenderCalibrationGate = class {
    status = "UNCALIBRATED";
    mapping = /* @__PURE__ */ new Map();
    constructor(status = "UNCALIBRATED", mapping) {
      this.status = status;
      if (mapping) {
        for (const [code, val] of Object.entries(mapping)) {
          this.mapping.set(String(code), val);
        }
      }
    }
    getStatus() {
      return this.status;
    }
    /**
     * 应用经过平台公开核验的映射证据切换至 CALIBRATED
     * @param mapping 经公开核验的映射字典
     */
    calibrate(mapping) {
      this.mapping.clear();
      for (const [code, val] of Object.entries(mapping)) {
        this.mapping.set(String(code), val);
      }
      this.status = "CALIBRATED";
    }
    resetToUncalibrated() {
      this.status = "UNCALIBRATED";
      this.mapping.clear();
    }
    /**
     * 将原始性别代码归一化为领域性别事实
     * 在 UNCALIBRATED 状态下，严格返回 'unknown'，Fail-Open
     */
    normalize(rawGender) {
      if (this.status !== "CALIBRATED" || rawGender === void 0 || rawGender === null) {
        return "unknown";
      }
      const key = String(rawGender);
      if (this.mapping.has(key)) {
        return this.mapping.get(key);
      }
      return "unknown";
    }
  };

  // src/domain/policy.ts
  var DEFAULT_POLICY = {
    contentKeyword: "",
    preferredRegions: ["\u5E7F\u4E1C"],
    allowedGenders: ["female", "unknown"],
    hideExcluded: false
  };

  // src/dom/card-extractor.ts
  function extractCardInfo(cardElement) {
    let title = "";
    const titleEl = cardElement.querySelector('.live-title, [class*="title"], .title, .name');
    if (titleEl) {
      title = titleEl.getAttribute("title") || titleEl.textContent || "";
    } else {
      const linkEl = cardElement.querySelector('a[href*="/live/"]');
      if (linkEl) {
        title = linkEl.getAttribute("title") || linkEl.textContent || "";
      } else {
        const imgEl = cardElement.querySelector("img[alt]");
        if (imgEl) {
          title = imgEl.getAttribute("alt") || "";
        }
      }
    }
    let nickname = "";
    const authorEl = cardElement.querySelector('.author-name, [class*="author"], [class*="nickname"], [class*="user-name"]');
    if (authorEl) {
      nickname = authorEl.textContent || "";
    }
    let userId = void 0;
    const userLinks = cardElement.querySelectorAll('a[href*="/user/profile/"], a[href*="/user/"]');
    for (const link of Array.from(userLinks)) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/user\/(?:profile\/)?([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        userId = match[1];
        break;
      }
    }
    if (!userId) {
      const dataUserId = cardElement.getAttribute("data-user-id") || cardElement.querySelector("[data-user-id]")?.getAttribute("data-user-id");
      if (dataUserId) {
        userId = dataUserId;
      }
    }
    return {
      cardElement,
      title: title.trim(),
      nickname: nickname.trim(),
      userId: userId?.trim() || void 0
    };
  }

  // src/dom/card-observer.ts
  var CardObserver = class {
    observer = null;
    knownCards = /* @__PURE__ */ new WeakSet();
    callbacks;
    constructor(callbacks) {
      this.callbacks = callbacks;
    }
    /**
     * 启动观察器
     * @param root 要观察的根节点，默认 document.body
     */
    start(root = document.body) {
      this.scan(root);
      this.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement) {
              this.scan(node);
            }
          }
        }
      });
      this.observer.observe(root, {
        childList: true,
        subtree: true
      });
    }
    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }
    /**
     * 扫描指定子树下的潜在直播卡片
     */
    scan(root) {
      const selector = '.live-card-item, [class*="live-card"], [class*="live-item"], [class*="feed-card"], .card-item, a[href*="/live/"]';
      if (this.isCardElement(root) && !this.knownCards.has(root)) {
        this.knownCards.add(root);
        this.callbacks.onCardDiscovered(root);
      }
      const matches = root.querySelectorAll(selector);
      for (const match of Array.from(matches)) {
        const card = this.resolveCardContainer(match);
        if (card && !this.knownCards.has(card)) {
          this.knownCards.add(card);
          this.callbacks.onCardDiscovered(card);
        }
      }
    }
    isCardElement(el) {
      const className = el.getAttribute("class") || "";
      return el.classList.contains("live-card-item") || el.classList.contains("card-item") || className.includes("live-card") || className.includes("live-item") || className.includes("feed-card");
    }
    resolveCardContainer(el) {
      const container = el.closest('.live-card-item, [class*="live-card"], [class*="live-item"], [class*="feed-card"], .card-item');
      if (container instanceof HTMLElement) {
        return container;
      }
      return el;
    }
  };

  // src/dom/card-presenter.ts
  var CardPresenter = class {
    /**
     * 应用关键词匹配结果展示
     */
    static applyContentMatch(cardElement, matched) {
      if (matched) {
        cardElement.style.visibility = "visible";
        cardElement.style.pointerEvents = "auto";
        cardElement.removeAttribute("data-xhs-filter-hidden");
      } else {
        cardElement.style.visibility = "hidden";
        cardElement.style.pointerEvents = "none";
        cardElement.setAttribute("data-xhs-filter-hidden", "true");
      }
    }
    /**
     * 应用领域评估结果（TARGET / CANDIDATE / EXCLUDED）
     * @param cardElement 卡片 DOM
     * @param evalResult 评估结果
     * @param facts 主播事实
     * @param hideExcluded 是否主动隐藏被排除卡片
     */
    static applyEvaluation(cardElement, evalResult, facts, hideExcluded = false) {
      if (evalResult.status === "EXCLUDED") {
        if (hideExcluded) {
          cardElement.style.visibility = "hidden";
          cardElement.style.pointerEvents = "none";
          cardElement.setAttribute("data-xhs-filter-excluded", "hidden");
        } else {
          cardElement.style.visibility = "visible";
          cardElement.style.pointerEvents = "auto";
          cardElement.style.opacity = "0.25";
          cardElement.style.filter = "grayscale(1)";
          cardElement.setAttribute("data-xhs-filter-excluded", "dimmed");
        }
        this.setBadge(cardElement, "\u26D4 \u5DF2\u6392\u9664", "#8c8c8c");
        return;
      }
      cardElement.style.opacity = "1";
      cardElement.style.filter = "none";
      cardElement.removeAttribute("data-xhs-filter-excluded");
      if (evalResult.status === "TARGET") {
        const regionLabel = facts.region !== "unknown" ? `\u{1F3AF} ${facts.region}` : "\u{1F3AF} \u504F\u597D";
        this.setBadge(cardElement, regionLabel, "#52c41a");
      } else {
        const regionLabel = facts.region !== "unknown" ? `\u26AA ${facts.region}` : "\u26AA \u666E\u901A";
        this.setBadge(cardElement, regionLabel, "#1890ff");
      }
    }
    /**
     * 附加或更新卡片徽标（Badge）
     */
    static setBadge(cardElement, text, color = "#ff2442") {
      let badge = cardElement.querySelector(".xhs-filter-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "xhs-filter-badge";
        badge.style.position = "absolute";
        badge.style.top = "8px";
        badge.style.left = "8px";
        badge.style.padding = "2px 8px";
        badge.style.borderRadius = "4px";
        badge.style.fontSize = "11px";
        badge.style.fontWeight = "bold";
        badge.style.color = "#fff";
        badge.style.zIndex = "10";
        badge.style.pointerEvents = "none";
        badge.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
        const position = window.getComputedStyle(cardElement).position;
        if (position === "static") {
          cardElement.style.position = "relative";
        }
        cardElement.appendChild(badge);
      }
      badge.textContent = text;
      badge.style.backgroundColor = color;
    }
  };

  // src/network/breaker.ts
  var CircuitBreaker = class {
    state = "RUNNING";
    callbacks;
    isProbing = false;
    constructor(callbacks) {
      this.callbacks = callbacks;
    }
    getState() {
      return this.state;
    }
    isPaused() {
      return this.state === "PAUSED";
    }
    /**
     * 触发限流熔断
     * @param reason 熔断触发原因
     */
    trip(reason) {
      if (this.state === "PAUSED") return;
      this.state = "PAUSED";
      console.warn(`[xhs-live-filter] CircuitBreaker TRIPPED to PAUSED: ${reason}`);
      this.callbacks.onStateChange(this.state);
    }
    /**
     * 用户手动点击 [恢复] 发起严格单次探测请求
     * @param probeFn 单次探测函数
     * @returns 探测是否成功
     */
    async manualProbe(probeFn) {
      if (this.state !== "PAUSED") {
        return true;
      }
      if (this.isProbing) {
        return false;
      }
      this.isProbing = true;
      try {
        console.log("[xhs-live-filter] Executing exactly one manual probe...");
        const success = await probeFn();
        if (success) {
          this.state = "RUNNING";
          console.log("[xhs-live-filter] Probe succeeded. System restored to RUNNING.");
          this.callbacks.onStateChange(this.state);
          return true;
        } else {
          console.warn("[xhs-live-filter] Probe returned false. Remaining in PAUSED state.");
          return false;
        }
      } catch (err) {
        console.warn("[xhs-live-filter] Probe failed or still limited. Remaining in PAUSED state:", err);
        return false;
      } finally {
        this.isProbing = false;
      }
    }
    reset() {
      this.state = "RUNNING";
      this.isProbing = false;
      this.callbacks.onStateChange(this.state);
    }
  };

  // src/storage/storage.ts
  var StorageAdapter = class {
    static isGMSupported() {
      return typeof GM_getValue === "function" && typeof GM_setValue === "function";
    }
    static get(key, defaultValue) {
      try {
        if (this.isGMSupported()) {
          return GM_getValue(key, defaultValue);
        }
        const raw = localStorage.getItem(`xhs_filter_${key}`);
        if (raw !== null) {
          return JSON.parse(raw);
        }
      } catch (e) {
        console.warn(`[xhs-live-filter] Read storage key '${key}' failed:`, e);
      }
      return defaultValue;
    }
    static set(key, value) {
      try {
        if (this.isGMSupported()) {
          GM_setValue(key, value);
          return;
        }
        localStorage.setItem(`xhs_filter_${key}`, JSON.stringify(value));
      } catch (e) {
        console.warn(`[xhs-live-filter] Write storage key '${key}' failed:`, e);
      }
    }
  };

  // src/network/cache.ts
  var ProfileCache = class _ProfileCache {
    static TTL_MS = 24 * 60 * 60 * 1e3;
    // 24小时
    static MAX_ENTRIES = 2e3;
    static STORAGE_KEY = "profile_cache_v1";
    l1Map = /* @__PURE__ */ new Map();
    constructor() {
      this.loadL2();
    }
    /**
     * 从 L1 或 L2 获取有效缓存项
     */
    get(userId) {
      if (!userId) return null;
      const now = Date.now();
      const l1Entry = this.l1Map.get(userId);
      if (l1Entry) {
        if (now - l1Entry.cachedAt < _ProfileCache.TTL_MS) {
          return l1Entry.facts;
        } else {
          this.l1Map.delete(userId);
        }
      }
      return null;
    }
    /**
     * 写入成功解析的 Profile Facts
     */
    set(userId, facts) {
      if (!userId || !facts.enriched) {
        return;
      }
      const entry = {
        facts,
        cachedAt: Date.now()
      };
      if (this.l1Map.size >= _ProfileCache.MAX_ENTRIES) {
        const oldestKey = this.l1Map.keys().next().value;
        if (oldestKey) {
          this.l1Map.delete(oldestKey);
        }
      }
      this.l1Map.set(userId, entry);
      this.persistL2();
    }
    /**
     * 加载 L2 持久化存储
     */
    loadL2() {
      const rawData = StorageAdapter.get(_ProfileCache.STORAGE_KEY, {});
      const now = Date.now();
      for (const [key, entry] of Object.entries(rawData)) {
        if (entry && typeof entry.cachedAt === "number" && now - entry.cachedAt < _ProfileCache.TTL_MS) {
          this.l1Map.set(key, entry);
        }
      }
    }
    /**
     * 持久化到 L2
     */
    persistL2() {
      const record = {};
      for (const [key, entry] of this.l1Map.entries()) {
        record[key] = entry;
      }
      StorageAdapter.set(_ProfileCache.STORAGE_KEY, record);
    }
    clear() {
      this.l1Map.clear();
      StorageAdapter.set(_ProfileCache.STORAGE_KEY, {});
    }
    size() {
      return this.l1Map.size;
    }
  };

  // src/network/profile-fetcher.ts
  var ProfileFetcher = class {
    fetcher;
    constructor(fetcher) {
      this.fetcher = fetcher || this.defaultFetch;
    }
    async defaultFetch(url) {
      const origin = typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null" ? window.location.origin : "https://www.xiaohongshu.com";
      const targetUrl = url.startsWith("http") ? url : `${origin}${url}`;
      const res = await fetch(targetUrl, {
        credentials: "same-origin",
        headers: {
          "Accept": "text/html,application/xhtml+xml"
        }
      });
      const text = await res.text();
      return { status: res.status, text };
    }
    /**
     * 拉取并解析 Anchor Profile Facts
     * @param userId Anchor userId
     */
    async fetchProfileFacts(userId) {
      if (!userId) {
        throw new Error("UserId cannot be empty");
      }
      const url = `/user/profile/${userId}`;
      const { status, text } = await this.fetcher(url);
      if (status === 429) {
        const err = new Error(`HTTP 429 Too Many Requests`);
        err.isRateLimited = true;
        throw err;
      }
      if (text.includes("captcha") || text.includes("\u9A8C\u8BC1\u7801") || text.includes("sec.xiaohongshu.com")) {
        const err = new Error(`Verification page detected`);
        err.isVerification = true;
        throw err;
      }
      if (status >= 400) {
        throw new Error(`Profile request failed with status ${status}`);
      }
      return this.parseProfileHtml(userId, text);
    }
    /**
     * 解析 Profile HTML 或 __INITIAL_STATE__
     */
    parseProfileHtml(userId, html) {
      let rawGender = void 0;
      let ipLocation = "unknown";
      const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?<\/script>/s);
      if (stateMatch && stateMatch[1]) {
        try {
          const cleanJson = stateMatch[1].replace(/:\s*undefined/g, ": null");
          const state = JSON.parse(cleanJson);
          const user = state?.user?.userPageData?.basicInfo || state?.user?.user?.basicInfo || state?.user?.userPageData;
          if (user) {
            if (user.gender !== void 0) {
              rawGender = user.gender;
            }
            if (user.ipLocation) {
              ipLocation = user.ipLocation;
            }
          }
        } catch (e) {
        }
      }
      if (ipLocation === "unknown") {
        const ipMatch = html.match(/IP\s*属地[：:]\s*([^\s<"']+)/) || html.match(/"ipLocation"\s*:\s*"([^"]+)"/);
        if (ipMatch && ipMatch[1]) {
          ipLocation = ipMatch[1];
        }
      }
      if (rawGender === void 0) {
        const genderMatch = html.match(/"gender"\s*:\s*([0-9]+)/);
        if (genderMatch && genderMatch[1]) {
          rawGender = parseInt(genderMatch[1], 10);
        }
      }
      let cleanRegion = ipLocation.replace(/^中国\s*/, "").trim();
      if (!cleanRegion) cleanRegion = "unknown";
      return {
        userId,
        rawGender,
        // 未校准状态下始终为 unknown (ADR-0003)
        gender: "unknown",
        region: cleanRegion,
        age: "unknown",
        enriched: true
      };
    }
  };

  // src/network/viewport-scheduler.ts
  var ViewportScheduler = class _ViewportScheduler {
    static MAX_CONCURRENCY = 2;
    static THROTTLE_INTERVAL_MS = 50;
    // 请求启动节流间隔
    observer = null;
    cardPriorityMap = /* @__PURE__ */ new WeakMap();
    queue = [];
    inFlightCount = 0;
    lastRequestStartTime = 0;
    breaker;
    isProcessing = false;
    constructor(breaker) {
      this.breaker = breaker;
      this.initObserver();
    }
    initObserver() {
      if (typeof IntersectionObserver !== "undefined") {
        this.observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const el = entry.target;
              if (entry.isIntersecting) {
                this.cardPriorityMap.set(el, "VISIBLE");
              } else {
                this.cardPriorityMap.set(el, "STALE");
              }
            }
            this.reorderQueue();
            this.schedule();
          },
          {
            root: null,
            rootMargin: "200px",
            // 200px 视口缓冲区
            threshold: [0, 0.1]
          }
        );
      }
    }
    observeCard(cardElement) {
      if (this.observer) {
        this.observer.observe(cardElement);
        if (!this.cardPriorityMap.has(cardElement)) {
          this.cardPriorityMap.set(cardElement, "BUFFER");
        }
      } else {
        this.cardPriorityMap.set(cardElement, "VISIBLE");
      }
    }
    unobserveCard(cardElement) {
      if (this.observer) {
        this.observer.unobserve(cardElement);
      }
    }
    /**
     * 手动设置卡片优先级（供测试或无 IntersectionObserver 环境调用）
     */
    setCardPriority(cardElement, priority) {
      this.cardPriorityMap.set(cardElement, priority);
      this.reorderQueue();
      this.schedule();
    }
    getCardPriority(cardElement) {
      return this.cardPriorityMap.get(cardElement) || "BUFFER";
    }
    enqueue(task) {
      if (this.queue.some((t) => t.userId === task.userId)) {
        return;
      }
      task.priority = this.getCardPriority(task.cardElement);
      this.queue.push(task);
      this.reorderQueue();
      this.schedule();
    }
    reorderQueue() {
      for (const item of this.queue) {
        item.priority = this.getCardPriority(item.cardElement);
      }
      this.queue = this.queue.filter((item) => item.priority !== "STALE");
      this.queue.sort((a, b) => {
        const scoreA = a.priority === "VISIBLE" ? 2 : 1;
        const scoreB = b.priority === "VISIBLE" ? 2 : 1;
        return scoreB - scoreA;
      });
    }
    schedule() {
      if (this.isProcessing) return;
      this.processNext();
    }
    async processNext() {
      this.isProcessing = true;
      try {
        while (this.queue.length > 0 && this.inFlightCount < _ViewportScheduler.MAX_CONCURRENCY && !this.breaker.isPaused()) {
          const now = Date.now();
          const elapsed = now - this.lastRequestStartTime;
          if (elapsed < _ViewportScheduler.THROTTLE_INTERVAL_MS) {
            const waitTime = _ViewportScheduler.THROTTLE_INTERVAL_MS - elapsed;
            await new Promise((r) => setTimeout(r, waitTime));
            if (this.breaker.isPaused()) break;
          }
          const task = this.queue.shift();
          if (!task) break;
          if (this.getCardPriority(task.cardElement) === "STALE") {
            continue;
          }
          this.inFlightCount++;
          this.lastRequestStartTime = Date.now();
          task.execute().catch((err) => {
            console.warn(`[xhs-live-filter] Task for ${task.userId} failed:`, err);
          }).finally(() => {
            this.inFlightCount--;
            this.schedule();
          });
        }
      } finally {
        this.isProcessing = false;
      }
    }
    getQueueLength() {
      return this.queue.length;
    }
    getInFlightCount() {
      return this.inFlightCount;
    }
    destroy() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.queue = [];
    }
  };

  // src/ui/filter-ui.ts
  var FilterUI = class {
    container;
    capsuleEl;
    panelEl;
    keywordInput;
    statsTextEl;
    recoverBtn;
    events;
    isExpanded = false;
    // Policy UI elements
    femaleCheckbox;
    maleCheckbox;
    unknownGenderCheckbox;
    regionInput;
    hideExcludedCheckbox;
    calibrationBadgeEl;
    constructor(events, initialPolicy) {
      this.events = events;
      this.container = document.createElement("div");
      this.container.id = "xhs-live-filter-root";
      this.container.style.cssText = `
      position: fixed;
      top: 80px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      color: #333;
    `;
      this.capsuleEl = document.createElement("div");
      this.capsuleEl.className = "xhs-capsule";
      this.capsuleEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ff2442;
      color: #fff;
      padding: 6px 14px;
      border-radius: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 36, 66, 0.35);
      user-select: none;
      transition: all 0.2s ease;
    `;
      this.capsuleEl.innerHTML = `
      <span class="capsule-icon" style="font-size: 14px;">\u{1F3AF}</span>
      <span class="capsule-title" style="font-weight: 600;">\u76F4\u64AD\u8FC7\u6EE4</span>
      <span class="capsule-count" style="font-size: 11px; opacity: 0.9; margin-left: 2px;">(0/0)</span>
    `;
      this.panelEl = document.createElement("div");
      this.panelEl.className = "xhs-filter-panel";
      this.panelEl.style.cssText = `
      display: none;
      width: 300px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border: 1px solid #eee;
      margin-top: 8px;
      padding: 14px;
      box-sizing: border-box;
    `;
      this.panelEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-weight: 700; font-size: 14px; color: #111;">\u76F4\u64AD\u8FC7\u6EE4\u5668</span>
        <button class="panel-close-btn" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #888;">\u2715</button>
      </div>

      <!-- \u5173\u952E\u8BCD\u7B5B\u9009 -->
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">\u5185\u5BB9\u5173\u952E\u8BCD</label>
        <div style="display: flex; gap: 6px;">
          <input type="text" class="keyword-input" placeholder="\u8F93\u5165\u6807\u9898\u6216\u6635\u79F0\u5173\u952E\u8BCD..." style="flex: 1; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
          <button class="clear-btn" style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;">\u6E05\u7A7A</button>
        </div>
      </div>

      <!-- \u6027\u522B\u7B5B\u9009 (Ticket #4) -->
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label style="font-weight: 600; font-size: 12px; color: #555;">\u5141\u8BB8\u6027\u522B</label>
          <span class="calibration-badge" style="font-size: 10px; color: #fa8c16; background: #fff7e6; padding: 1px 6px; border-radius: 4px; border: 1px solid #ffd591;">\u95E8\u7981: UNCALIBRATED (Fail-Open)</span>
        </div>
        <div style="display: flex; gap: 12px; font-size: 12px; color: #444;">
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-female" checked /> \u5973\u6027
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-male" /> \u7537\u6027
          </label>
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" class="gender-unknown" checked /> \u672A\u77E5/\u672A\u6821\u51C6
          </label>
        </div>
      </div>

      <!-- \u504F\u597D\u5C5E\u5730 (Ticket #3/4) -->
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #555;">\u504F\u597D\u5C5E\u5730 (\u9017\u53F7\u5206\u9694)</label>
        <input type="text" class="region-input" value="\u5E7F\u4E1C" placeholder="\u5982\uFF1A\u5E7F\u4E1C,\u4E0A\u6D77" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; outline: none;" />
      </div>

      <!-- \u5E74\u9F84 (\u7F6E\u7070\u4E0D\u53EF\u7528) -->
      <div style="margin-bottom: 12px; opacity: 0.6;">
        <label style="display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; color: #999;">\u5E74\u9F84\u533A\u95F4 (\u516C\u5F00\u6570\u636E\u4E0D\u53EF\u7528 \xB7 \u5DF2\u7981\u7528)</label>
        <input type="text" disabled value="\u4E0D\u9650 (Fail-Open)" style="width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid #eee; border-radius: 6px; font-size: 12px; background: #fafafa; color: #aaa; cursor: not-allowed;" />
      </div>

      <!-- \u89C6\u56FE\u63A7\u5236\uFF1AhideExcluded (\u9ED8\u8BA4\u5173\u95ED) -->
      <div style="margin-bottom: 12px; padding-top: 6px; border-top: 1px dashed #eee;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #444; cursor: pointer;">
          <input type="checkbox" class="hide-excluded-checkbox" />
          <span>\u9690\u85CF\u5DF2\u6392\u9664\u4E3B\u64AD (\u9ED8\u8BA4\u4F4E\u900F\u660E\u5EA6\u4FDD\u7559)</span>
        </label>
      </div>

      <div class="stats-section" style="padding: 8px; background: #f9f9f9; border-radius: 6px; font-size: 11px; color: #666; margin-bottom: 8px;">
        \u7EDF\u8BA1: <span class="stats-text">0 \u5361\u7247</span>
      </div>

      <div class="paused-warning" style="display: none; padding: 6px 8px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 6px; font-size: 11px; color: #d46b08; margin-bottom: 8px; justify-content: space-between; align-items: center;">
        <span>\u26A0\uFE0F \u5DF2\u6682\u505C \xB7 \u98CE\u63A7\u4FDD\u62A4</span>
        <button class="recover-btn" style="padding: 2px 8px; background: #fa8c16; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">\u6062\u590D</button>
      </div>
    `;
      this.container.appendChild(this.capsuleEl);
      this.container.appendChild(this.panelEl);
      this.keywordInput = this.panelEl.querySelector(".keyword-input");
      const clearBtn = this.panelEl.querySelector(".clear-btn");
      const closeBtn = this.panelEl.querySelector(".panel-close-btn");
      this.statsTextEl = this.panelEl.querySelector(".stats-text");
      this.recoverBtn = this.panelEl.querySelector(".recover-btn");
      this.femaleCheckbox = this.panelEl.querySelector(".gender-female");
      this.maleCheckbox = this.panelEl.querySelector(".gender-male");
      this.unknownGenderCheckbox = this.panelEl.querySelector(".gender-unknown");
      this.regionInput = this.panelEl.querySelector(".region-input");
      this.hideExcludedCheckbox = this.panelEl.querySelector(".hide-excluded-checkbox");
      this.calibrationBadgeEl = this.panelEl.querySelector(".calibration-badge");
      if (initialPolicy) {
        this.syncPolicyToUI(initialPolicy);
      }
      this.capsuleEl.addEventListener("click", () => this.togglePanel());
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.togglePanel(false);
      });
      this.keywordInput.addEventListener("input", () => {
        this.events.onKeywordChange(this.keywordInput.value);
      });
      clearBtn.addEventListener("click", () => {
        this.keywordInput.value = "";
        this.events.onClearKeyword();
      });
      this.recoverBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.events.onManualRecover) {
          this.events.onManualRecover();
        }
      });
      const handlePolicyUpdate = () => {
        const allowedGenders = [];
        if (this.femaleCheckbox.checked) allowedGenders.push("female");
        if (this.maleCheckbox.checked) allowedGenders.push("male");
        if (this.unknownGenderCheckbox.checked) allowedGenders.push("unknown");
        const regions = this.regionInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        const hideExcluded = this.hideExcludedCheckbox.checked;
        if (this.events.onPolicyChange) {
          this.events.onPolicyChange({
            allowedGenders,
            preferredRegions: regions,
            hideExcluded
          });
        }
      };
      this.femaleCheckbox.addEventListener("change", handlePolicyUpdate);
      this.maleCheckbox.addEventListener("change", handlePolicyUpdate);
      this.unknownGenderCheckbox.addEventListener("change", handlePolicyUpdate);
      this.regionInput.addEventListener("input", handlePolicyUpdate);
      this.hideExcludedCheckbox.addEventListener("change", handlePolicyUpdate);
    }
    syncPolicyToUI(policy) {
      this.keywordInput.value = policy.contentKeyword;
      this.femaleCheckbox.checked = policy.allowedGenders.includes("female");
      this.maleCheckbox.checked = policy.allowedGenders.includes("male");
      this.unknownGenderCheckbox.checked = policy.allowedGenders.includes("unknown");
      this.regionInput.value = policy.preferredRegions.join(", ");
      this.hideExcludedCheckbox.checked = policy.hideExcluded;
    }
    setCalibrationStatus(status) {
      if (status === "CALIBRATED") {
        this.calibrationBadgeEl.textContent = "\u95E8\u7981: CALIBRATED";
        this.calibrationBadgeEl.style.color = "#52c41a";
        this.calibrationBadgeEl.style.background = "#f6ffed";
        this.calibrationBadgeEl.style.borderColor = "#b7eb8f";
      } else {
        this.calibrationBadgeEl.textContent = "\u95E8\u7981: UNCALIBRATED (Fail-Open)";
        this.calibrationBadgeEl.style.color = "#fa8c16";
        this.calibrationBadgeEl.style.background = "#fff7e6";
        this.calibrationBadgeEl.style.borderColor = "#ffd591";
      }
    }
    mount(root = document.body) {
      if (!document.getElementById("xhs-live-filter-root")) {
        root.appendChild(this.container);
      }
    }
    setKeyword(keyword) {
      this.keywordInput.value = keyword;
    }
    getKeyword() {
      return this.keywordInput.value;
    }
    togglePanel(expanded) {
      this.isExpanded = expanded !== void 0 ? expanded : !this.isExpanded;
      this.panelEl.style.display = this.isExpanded ? "block" : "none";
      if (this.events.onTogglePanel) {
        this.events.onTogglePanel(this.isExpanded);
      }
    }
    updateStats(stats) {
      const countEl = this.capsuleEl.querySelector(".capsule-count");
      if (countEl) {
        countEl.textContent = `(${stats.matchedCards}/${stats.totalCards})`;
      }
      let statsDetail = `\u53D1\u73B0 ${stats.totalCards} \u5F20\u5361\u7247\uFF0C\u5339\u914D ${stats.matchedCards} \u5F20`;
      if (stats.targetCards !== void 0 && stats.candidateCards !== void 0) {
        statsDetail += ` (\u{1F3AF} ${stats.targetCards} \u4F18\u5148 | \u26AA ${stats.candidateCards} \u666E\u901A)`;
      }
      if (stats.excludedCards !== void 0 && stats.excludedCards > 0) {
        statsDetail += ` [\u26D4 \u6392\u9664 ${stats.excludedCards}]`;
      }
      this.statsTextEl.textContent = statsDetail;
      const pausedEl = this.panelEl.querySelector(".paused-warning");
      if (pausedEl) {
        if (stats.isPaused) {
          pausedEl.style.display = "flex";
          this.capsuleEl.style.background = "#fa8c16";
          const capsuleTitle = this.capsuleEl.querySelector(".capsule-title");
          if (capsuleTitle) capsuleTitle.textContent = "\u5DF2\u6682\u505C \xB7 \u98CE\u63A7\u4FDD\u62A4";
        } else {
          pausedEl.style.display = "none";
          this.capsuleEl.style.background = "#ff2442";
          const capsuleTitle = this.capsuleEl.querySelector(".capsule-title");
          if (capsuleTitle) capsuleTitle.textContent = "\u76F4\u64AD\u8FC7\u6EE4";
        }
      }
    }
    getPanelElement() {
      return this.panelEl;
    }
    getCapsuleElement() {
      return this.capsuleEl;
    }
  };

  // src/app.ts
  var LiveFilterApp = class {
    cards = /* @__PURE__ */ new Map();
    factsMap = /* @__PURE__ */ new Map();
    observer;
    ui;
    policy;
    cache;
    fetcher;
    calibrationGate;
    breaker;
    scheduler;
    constructor(customFetcher, calibrationGate, customBreaker) {
      const savedKeyword = StorageAdapter.get("contentKeyword", "");
      const savedRegions = StorageAdapter.get("preferredRegions", DEFAULT_POLICY.preferredRegions);
      const savedGenders = StorageAdapter.get("allowedGenders", DEFAULT_POLICY.allowedGenders);
      const savedHideExcluded = StorageAdapter.get("hideExcluded", DEFAULT_POLICY.hideExcluded);
      this.policy = {
        contentKeyword: savedKeyword,
        preferredRegions: savedRegions,
        allowedGenders: savedGenders,
        hideExcluded: savedHideExcluded
      };
      this.cache = new ProfileCache();
      this.fetcher = customFetcher || new ProfileFetcher();
      this.calibrationGate = calibrationGate || new GenderCalibrationGate();
      this.breaker = customBreaker || new CircuitBreaker({
        onStateChange: () => this.updateStats()
      });
      this.scheduler = new ViewportScheduler(this.breaker);
      this.ui = new FilterUI(
        {
          onKeywordChange: (kw) => this.handleKeywordChange(kw),
          onClearKeyword: () => this.handleKeywordChange(""),
          onPolicyChange: (partialPolicy) => this.handlePolicyChange(partialPolicy),
          onManualRecover: () => this.handleManualRecover()
        },
        this.policy
      );
      this.ui.setCalibrationStatus(this.calibrationGate.getStatus());
      this.observer = new CardObserver({
        onCardDiscovered: (card) => this.handleCardDiscovered(card)
      });
    }
    start(root = document.body) {
      this.ui.mount(root);
      this.ui.setKeyword(this.policy.contentKeyword);
      this.observer.start(root);
      this.refreshAll();
    }
    destroy() {
      this.observer.stop();
      this.scheduler.destroy();
      this.cards.clear();
      this.factsMap.clear();
    }
    handleCardDiscovered(cardElement) {
      if (this.cards.has(cardElement)) return;
      const info = extractCardInfo(cardElement);
      this.cards.set(cardElement, info);
      this.scheduler.observeCard(cardElement);
      this.evaluateContentMatch(info);
      if (!info.userId) {
        const unknownFacts = createUnknownFacts();
        this.applyCardEvaluation(info, unknownFacts);
      } else {
        const cached = this.cache.get(info.userId);
        if (cached) {
          cached.gender = this.calibrationGate.normalize(cached.rawGender);
          this.factsMap.set(info.userId, cached);
          this.applyCardEvaluation(info, cached);
        } else {
          this.enqueueEnrichment(info.userId, cardElement);
        }
      }
      this.updateStats();
    }
    enqueueEnrichment(userId, cardElement) {
      this.scheduler.enqueue({
        userId,
        cardElement,
        priority: this.scheduler.getCardPriority(cardElement),
        execute: async () => {
          try {
            const facts = await this.fetcher.fetchProfileFacts(userId);
            facts.gender = this.calibrationGate.normalize(facts.rawGender);
            this.cache.set(userId, facts);
            this.factsMap.set(userId, facts);
            for (const info of this.cards.values()) {
              if (info.userId === userId) {
                this.applyCardEvaluation(info, facts);
              }
            }
          } catch (err) {
            const isRateLimited = err?.isRateLimited;
            const isVerification = err?.isVerification;
            if (isRateLimited || isVerification) {
              this.breaker.trip(isRateLimited ? "HTTP 429 \u9650\u6D41" : "\u51FA\u73B0\u9A8C\u8BC1\u7801\u91CD\u5B9A\u5411");
            } else {
              console.warn(`[xhs-live-filter] Enrich user ${userId} failed (ordinary):`, err);
            }
          } finally {
            this.updateStats();
          }
        }
      });
    }
    handleKeywordChange(keyword) {
      this.policy.contentKeyword = keyword;
      StorageAdapter.set("contentKeyword", keyword);
      this.refreshContentMatches();
    }
    handlePolicyChange(partialPolicy) {
      this.policy = { ...this.policy, ...partialPolicy };
      StorageAdapter.set("allowedGenders", this.policy.allowedGenders);
      StorageAdapter.set("preferredRegions", this.policy.preferredRegions);
      StorageAdapter.set("hideExcluded", this.policy.hideExcluded);
      this.refreshEvaluationsOnly();
    }
    /**
     * 用户手动点击 [恢复] 按钮触发单次受控探针
     * 严格执行 exactly one probe request，绝不启动自动循环
     */
    async handleManualRecover() {
      return this.breaker.manualProbe(async () => {
        let targetUserId = null;
        for (const info of this.cards.values()) {
          if (info.userId && !this.factsMap.has(info.userId) && !this.cache.get(info.userId)) {
            targetUserId = info.userId;
            break;
          }
        }
        if (!targetUserId) {
          return true;
        }
        try {
          const facts = await this.fetcher.fetchProfileFacts(targetUserId);
          facts.gender = this.calibrationGate.normalize(facts.rawGender);
          this.cache.set(targetUserId, facts);
          this.factsMap.set(targetUserId, facts);
          for (const info of this.cards.values()) {
            if (info.userId === targetUserId) {
              this.applyCardEvaluation(info, facts);
            }
          }
          return true;
        } catch (err) {
          const isRateLimited = err?.isRateLimited;
          const isVerification = err?.isVerification;
          if (isRateLimited || isVerification) {
            return false;
          }
          return true;
        }
      });
    }
    calibrateGender(mapping) {
      this.calibrationGate.calibrate(mapping);
      this.ui.setCalibrationStatus(this.calibrationGate.getStatus());
      for (const facts of this.factsMap.values()) {
        facts.gender = this.calibrationGate.normalize(facts.rawGender);
      }
      this.refreshEvaluationsOnly();
    }
    evaluateContentMatch(info) {
      const matched = matchContent(this.policy.contentKeyword, info.title, info.nickname);
      CardPresenter.applyContentMatch(info.cardElement, matched);
    }
    applyCardEvaluation(info, facts) {
      const result = evaluate(facts, this.policy);
      CardPresenter.applyEvaluation(info.cardElement, result, facts, this.policy.hideExcluded);
    }
    refreshContentMatches() {
      for (const info of this.cards.values()) {
        this.evaluateContentMatch(info);
      }
      this.updateStats();
    }
    refreshEvaluationsOnly() {
      for (const info of this.cards.values()) {
        const facts = info.userId ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId) : createUnknownFacts();
        this.applyCardEvaluation(info, facts);
      }
      this.updateStats();
    }
    refreshAll() {
      this.refreshContentMatches();
      this.refreshEvaluationsOnly();
    }
    updateStats() {
      let matchedCount = 0;
      let targetCount = 0;
      let candidateCount = 0;
      let excludedCount = 0;
      for (const info of this.cards.values()) {
        if (matchContent(this.policy.contentKeyword, info.title, info.nickname)) {
          matchedCount++;
        }
        const facts = info.userId ? this.factsMap.get(info.userId) || this.cache.get(info.userId) || createUnknownFacts(info.userId) : createUnknownFacts();
        const evalRes = evaluate(facts, this.policy);
        if (evalRes.status === "TARGET") {
          targetCount++;
        } else if (evalRes.status === "CANDIDATE") {
          candidateCount++;
        } else if (evalRes.status === "EXCLUDED") {
          excludedCount++;
        }
      }
      const stats = {
        totalCards: this.cards.size,
        matchedCards: matchedCount,
        targetCards: targetCount,
        candidateCards: candidateCount,
        excludedCards: excludedCount,
        isPaused: this.breaker.isPaused()
      };
      this.ui.updateStats(stats);
    }
    // 供测试与检查的接口
    getDiscoveredCardsCount() {
      return this.cards.size;
    }
    getUI() {
      return this.ui;
    }
    getCache() {
      return this.cache;
    }
    getPolicy() {
      return this.policy;
    }
    getKeyword() {
      return this.policy.contentKeyword;
    }
    getCalibrationGate() {
      return this.calibrationGate;
    }
    getBreaker() {
      return this.breaker;
    }
    getScheduler() {
      return this.scheduler;
    }
    setPolicy(policy) {
      this.handlePolicyChange(policy);
    }
  };

  // src/main.ts
  function bootstrap() {
    if (window.__XHS_LIVE_FILTER_LOADED__) {
      return;
    }
    window.__XHS_LIVE_FILTER_LOADED__ = true;
    const app = new LiveFilterApp();
    app.start(document.body);
    console.log("[xhs-live-filter] v0.1.0 started successfully");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
