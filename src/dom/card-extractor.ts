/**
 * 卡片原生 DOM 内容与标识提取器
 */

export interface ExtractedCardInfo {
  cardElement: HTMLElement;
  title: string;
  nickname: string;
  userId?: string;
}

export function extractCardInfo(cardElement: HTMLElement): ExtractedCardInfo {
  // 1. 提取直播标题
  let title = '';
  const titleEl = cardElement.querySelector('.live-title, [class*="title"], .title, .name');
  if (titleEl) {
    title = titleEl.getAttribute('title') || titleEl.textContent || '';
  } else {
    const linkEl = cardElement.querySelector('a[href*="/live/"]');
    if (linkEl) {
      title = linkEl.getAttribute('title') || linkEl.textContent || '';
    } else {
      const imgEl = cardElement.querySelector('img[alt]');
      if (imgEl) {
        title = imgEl.getAttribute('alt') || '';
      }
    }
  }

  // 2. 提取主播昵称
  let nickname = '';
  const authorEl = cardElement.querySelector('.author-name, [class*="author"], [class*="nickname"], [class*="user-name"]');
  if (authorEl) {
    nickname = authorEl.textContent || '';
  }

  // 3. 提取 Anchor userId (从主页链接提取)
  let userId: string | undefined = undefined;
  const userLinks = cardElement.querySelectorAll('a[href*="/user/profile/"], a[href*="/user/"]');
  for (const link of Array.from(userLinks)) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/user\/(?:profile\/)?([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      userId = match[1];
      break;
    }
  }

  // 4. 支持 data-user-id 属性回退
  if (!userId) {
    const dataUserId = cardElement.getAttribute('data-user-id') || cardElement.querySelector('[data-user-id]')?.getAttribute('data-user-id');
    if (dataUserId) {
      userId = dataUserId;
    }
  }

  return {
    cardElement,
    title: title.trim(),
    nickname: nickname.trim(),
    userId: userId?.trim() || undefined,
  };
}
