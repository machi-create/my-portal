document.addEventListener('DOMContentLoaded', () => {
  // 1. スクロール時の要素フェードイン (Scroll Reveal)
  const revealElements = document.querySelectorAll('.scroll-reveal');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // 一度表示されたら以降はそのまま
      }
    });
  }, {
    root: null,
    threshold: 0.15,
    rootMargin: "0px 0px -50px 0px"
  });

  revealElements.forEach(el => revealObserver.observe(el));

  // 2. ナビゲーションの現在位置アクティブ表示切替 (Active Nav Tracking)
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        if (id) {
          navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            }
          });
        }
      }
    });
  }, {
    root: null,
    threshold: 0.2,
    rootMargin: "-20% 0px -60% 0px" // セクションが画面のどの位置に来たらアクティブにするか調整
  });

  sections.forEach(sec => sectionObserver.observe(sec));

  // セクションが一番上にない場合（Heroセクション）のハイライト解除用
  window.addEventListener('scroll', () => {
    if (window.scrollY < 200) {
      navLinks.forEach(link => link.classList.remove('active'));
    }
  }, { passive: true });

  // 3. 背景オーブの軽いパララックス効果
  const orbs = document.querySelectorAll('.bg-orb');
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        orbs.forEach((orb, index) => {
          // オーブごとに少し速度を変えてスクロール時の浮遊感を出す
          const speed = index === 0 ? 0.08 : -0.06;
          orb.style.transform = `translateY(${scrollY * speed}px)`;
        });
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
});
