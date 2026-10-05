/**
 * 代表性小红书直播广场 DOM Fixture
 * 模拟真实页面的卡片网格布局、直播标题、主播昵称以及主页链接
 */
export function createLiveSquareFixture(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'live-list-container';
  container.id = 'live-list-app';
  container.innerHTML = `
    <div class="live-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
      <!-- 卡片 1: 包含关键词'艺术'，主播'李小花' -->
      <div class="live-card-item" data-id="card-1">
        <a class="cover-link" href="/live/65001">
          <img class="cover-img" src="https://example.com/cover1.jpg" alt="cover" />
        </a>
        <div class="info-wrapper">
          <div class="live-title" title="当代艺术画展与陶瓷手作现场">当代艺术画展与陶瓷手作现场</div>
          <div class="author-info">
            <a class="author-avatar-link" href="/user/profile/user_001">
              <span class="author-name">李小花</span>
            </a>
          </div>
        </div>
      </div>

      <!-- 卡片 2: 包含关键词'编程'，主播'张大伟' -->
      <div class="live-card-item" data-id="card-2">
        <a class="cover-link" href="/live/65002">
          <img class="cover-img" src="https://example.com/cover2.jpg" alt="cover" />
        </a>
        <div class="info-wrapper">
          <div class="live-title" title="前端 TypeScript 与 React 架构实战">前端 TypeScript 与 React 架构实战</div>
          <div class="author-info">
            <a class="author-avatar-link" href="/user/profile/user_002">
              <span class="author-name">张大伟</span>
            </a>
          </div>
        </div>
      </div>

      <!-- 卡片 3: 包含关键词'户外'，主播'王艺术'（昵称中包含艺术） -->
      <div class="live-card-item" data-id="card-3">
        <a class="cover-link" href="/live/65003">
          <img class="cover-img" src="https://example.com/cover3.jpg" alt="cover" />
        </a>
        <div class="info-wrapper">
          <div class="live-title" title="周末户外徒步登山直播">周末户外徒步登山直播</div>
          <div class="author-info">
            <a class="author-avatar-link" href="/user/profile/user_003">
              <span class="author-name">王艺术</span>
            </a>
          </div>
        </div>
      </div>

      <!-- 卡片 4: 无法提取 userId 的卡片 -->
      <div class="live-card-item" data-id="card-4">
        <div class="info-wrapper">
          <div class="live-title" title="纯音乐助眠电台">纯音乐助眠电台</div>
          <div class="author-info">
            <span class="author-name">匿名电台</span>
          </div>
        </div>
      </div>
    </div>
  `;
  return container;
}
