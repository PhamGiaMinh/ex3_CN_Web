"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const data = [
    { name: "Nguyễn Thị Hồng Anh", role: "Nhân viên văn phòng", city: "TP.HCM", avatar: "images/avatar1.jpg", quote: "Mình mất gốc tiếng Anh hoàn toàn nhưng sau 2 tháng dùng EngLingo mỗi tối 15 phút, mình đã tự tin nói chuyện cơ bản với người nước ngoài." },
    { name: "Trần Minh Khang", role: "Sinh viên năm 2", city: "Hà Nội", avatar: "images/avatar2.jpg", quote: "Phần luyện phát âm bằng AI thực sự hữu ích, mình biết chính xác mình sai ở âm nào để sửa ngay." },
    { name: "Lê Phương Thảo", role: "Giáo viên tiểu học", city: "Đà Nẵng", avatar: "images/avatar3.jpg", quote: "Lộ trình học rất rõ ràng, không bị ngợp như khi mình tự học qua Youtube trước đây." }
  ];
  initNavigation();
  initTheme();
  initTestimonials(data);
  initTrialForm();
  initAuthModal();
});

function initNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".menu");
  const links = [...document.querySelectorAll('.menu a[href^="#"]')];
  const sections = [...document.querySelectorAll("main section[id]")];
  const setMenu = (open) => {
    menu.classList.toggle("menu--open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector('[aria-hidden="true"]').textContent = open ? "×" : "☰";
  };

  toggle.addEventListener("click", () => setMenu(!menu.classList.contains("menu--open")));
  links.forEach((link) => link.addEventListener("click", () => setMenu(false)));

  const updateActiveLink = () => {
    const offset = document.querySelector("header").offsetHeight + 24;
    const active = sections.reduce((current, section) => (
      section.getBoundingClientRect().top <= offset ? section : current
    ), sections[0]);
    links.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${active.id}`);
    });
  };
  window.addEventListener("scroll", updateActiveLink, { passive: true });
  updateActiveLink();
}

function initTheme() {
  const button = document.querySelector(".theme-toggle");
  const saved = localStorage.getItem("englingo-theme");
  applyTheme(saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  button.addEventListener("click", () => {
    const next = document.body.classList.contains("dark-theme") ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("englingo-theme", next);
  });
  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-theme", isDark);
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", isDark ? "Bật chế độ sáng" : "Bật chế độ tối");
    button.querySelector('[aria-hidden="true"]').textContent = isDark ? "☀" : "☾";
    button.querySelector(".theme-toggle-label").textContent = isDark ? "Sáng" : "Tối";
  }
}

function initTestimonials(data) {
  const track = document.querySelector(".testimonial-list");
  const dots = document.querySelector(".slider-dots");
  const controls = [...document.querySelectorAll(".slider-button")];
  const slider = document.querySelector(".testimonial-slider");
  const empty = document.querySelector(".no-results");
  const search = document.querySelector("#testimonial-search");
  const city = document.querySelector("#testimonial-city");
  let items = data;
  let index = 0;
  let timer;

  function renderItems(list) {
    empty.hidden = list.length > 0;
    controls.forEach((button) => { button.disabled = list.length < 2; });

    // map() chuyển từng object dữ liệu thành các phần tử DOM cho slider.
    const cards = list.map((item) => {
      const card = document.createElement("blockquote");
      card.className = "testimonial";
      const image = document.createElement("img");
      image.className = "testimonial-photo";
      image.src = item.avatar;
      image.alt = `Ảnh đại diện của ${item.name}`;
      const body = document.createElement("div");
      body.className = "testimonial-body";
      const quote = document.createElement("p");
      quote.textContent = item.quote;
      const footer = document.createElement("footer");
      const cite = document.createElement("cite");
      cite.textContent = item.name;
      footer.append(cite, document.createTextNode(` — ${item.role}, ${item.city}`));
      body.append(quote, footer);
      card.append(image, body);
      return card;
    });

    const dotButtons = list.map((item, itemIndex) => {
      const dot = document.createElement("button");
      dot.className = "slider-dot";
      dot.type = "button";
      dot.setAttribute("aria-label", `Xem cảm nhận ${itemIndex + 1} của ${item.name}`);
      dot.addEventListener("click", () => showSlide(itemIndex));
      return dot;
    });

    track.replaceChildren(...cards);
    dots.replaceChildren(...dotButtons);
    showSlide(0);
  }

  function showSlide(nextIndex) {
    if (!items.length) return;
    index = (nextIndex + items.length) % items.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    [...dots.children].forEach((dot, dotIndex) => {
      const active = dotIndex === index;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-current", String(active));
    });
  }
  function restartAutoSlide() {
    clearInterval(timer);
    if (items.length > 1) timer = setInterval(() => showSlide(index + 1), 5000);
  }
  function filterItems() {
    const keyword = normalize(search.value);
    items = data.filter((item) => {
      const text = normalize(`${item.name} ${item.role} ${item.city} ${item.quote}`);
      return (!keyword || text.includes(keyword)) && (!city.value || item.city === city.value);
    });
    renderItems(items);
    restartAutoSlide();
  }

  controls.forEach((button) => button.addEventListener("click", () => showSlide(index + (button.dataset.direction === "next" ? 1 : -1))));
  search.addEventListener("input", filterItems);
  city.addEventListener("change", filterItems);
  slider.addEventListener("mouseenter", () => clearInterval(timer));
  slider.addEventListener("mouseleave", restartAutoSlide);
  slider.addEventListener("focusin", () => clearInterval(timer));
  slider.addEventListener("focusout", restartAutoSlide);
  renderItems(items);
  restartAutoSlide();
}

function initTrialForm() {
  const form = document.querySelector("#trial-form");
  const success = document.querySelector("#form-success");
  const fields = [form.elements.fullName, form.elements.email];
  function validate(field) {
    const value = field.value.trim();
    let message = !value ? (field.name === "fullName" ? "Vui lòng nhập họ và tên." : "Vui lòng nhập email.") : "";
    if (field.name === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = "Email chưa đúng định dạng.";
    form.querySelector(`[data-error-for="${field.name}"]`).textContent = message;
    field.classList.toggle("is-invalid", Boolean(message));
    field.setAttribute("aria-invalid", String(Boolean(message)));
    return !message;
  }
  fields.forEach((field) => field.addEventListener("input", () => { validate(field); success.hidden = true; }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!fields.every(validate)) return form.querySelector(".is-invalid").focus();
    success.textContent = `Cảm ơn ${form.elements.fullName.value.trim()}! Đăng ký học thử của bạn đã được ghi nhận.`;
    success.hidden = false;
    form.reset();
  });
}

function initAuthModal() {
  const modal = document.createElement("div");
  modal.className = "auth-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `<div class="auth-backdrop" data-close-auth></div><section class="auth-dialog" aria-labelledby="auth-title"><button class="auth-close" type="button" aria-label="Đóng" data-close-auth>×</button><aside class="auth-visual"><div class="auth-mark">E</div><h2>EngLingo</h2><p id="auth-visual-text"></p><div class="auth-benefit">✓ &nbsp; 15 phút mỗi ngày, tiến bộ từng bước</div></aside><div class="auth-content"><p class="auth-eyebrow">CHÀO MỪNG BẠN</p><h2 id="auth-title"></h2><p id="auth-description" class="auth-description"></p><form id="auth-form" novalidate></form><p id="auth-switch" class="auth-switch"></p></div></section>`;
  document.body.append(modal);
  const title = modal.querySelector("#auth-title");
  const description = modal.querySelector("#auth-description");
  const visualText = modal.querySelector("#auth-visual-text");
  const form = modal.querySelector("#auth-form");
  const switcher = modal.querySelector("#auth-switch");
  let previousFocus;
  const views = {
    login: { title: "Đăng nhập", description: "Tiếp tục hành trình học tiếng Anh của bạn.", visual: "Chào mừng bạn quay trở lại với EngLingo.", fields: [["email", "Email", "email", "ban@email.com"], ["password", "Mật khẩu", "password", "Nhập mật khẩu"]], submit: "Đăng nhập", switchText: "Chưa có tài khoản?", switchAction: "Đăng ký miễn phí", switchView: "signup", forgot: true },
    signup: { title: "Tạo tài khoản miễn phí", description: "Bắt đầu học thử chỉ trong vài giây.", visual: "Tạo thói quen học tiếng Anh cùng EngLingo.", fields: [["name", "Họ và tên", "text", "Nhập họ và tên"], ["email", "Email", "email", "ban@email.com"], ["password", "Mật khẩu", "password", "Tối thiểu 6 ký tự"]], submit: "Tạo tài khoản", switchText: "Đã có tài khoản?", switchAction: "Đăng nhập", switchView: "login" },
    forgot: { title: "Quên mật khẩu?", description: "Nhập email để nhận hướng dẫn đặt lại mật khẩu.", visual: "Chúng tôi sẽ giúp bạn lấy lại tài khoản.", fields: [["email", "Email", "email", "ban@email.com"]], submit: "Gửi hướng dẫn", switchText: "Nhớ mật khẩu rồi?", switchAction: "Đăng nhập", switchView: "login" }
  };
  const open = (view) => { previousFocus = document.activeElement; render(view); modal.hidden = false; document.body.classList.add("modal-open"); modal.querySelector("input").focus(); };
  const close = () => { modal.hidden = true; document.body.classList.remove("modal-open"); previousFocus?.focus(); };
  function render(view) {
    const config = views[view];
    title.textContent = config.title; description.textContent = config.description; visualText.textContent = config.visual; form.replaceChildren(); form.dataset.view = view;
    config.fields.forEach(([name, label, type, placeholder]) => {
      const group = document.createElement("div"); group.className = "auth-field";
      group.innerHTML = `<label for="auth-${name}">${label}</label><input id="auth-${name}" name="${name}" type="${type}" placeholder="${placeholder}" required><p class="auth-error" data-error="${name}"></p>`;
      form.append(group);
    });
    if (config.forgot) form.insertAdjacentHTML("beforeend", '<button class="auth-link-button auth-forgot" type="button" data-auth-view="forgot">Quên mật khẩu?</button>');
    form.insertAdjacentHTML("beforeend", `<button class="auth-submit" type="submit">${config.submit}</button><p class="auth-success" role="status" hidden></p>`);
    switcher.innerHTML = `${config.switchText} <button class="auth-link-button" type="button" data-auth-view="${config.switchView}">${config.switchAction}</button>`;
  }
  function validate(input) {
    const value = input.value.trim(); let message = value ? "" : "Trường này là bắt buộc.";
    if (input.name === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = "Email chưa đúng định dạng.";
    if (input.name === "password" && value && value.length < 6) message = "Mật khẩu cần ít nhất 6 ký tự.";
    input.classList.toggle("is-invalid", Boolean(message)); input.setAttribute("aria-invalid", String(Boolean(message))); form.querySelector(`[data-error="${input.name}"]`).textContent = message;
    return !message;
  }
  document.querySelectorAll('a[href="/dang-nhap"], a[href="/dang-ky"]').forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); open(link.getAttribute("href") === "/dang-nhap" ? "login" : "signup"); }));
  modal.addEventListener("click", (event) => { if (event.target.matches("[data-close-auth]")) close(); if (event.target.dataset.authView) render(event.target.dataset.authView); });
  form.addEventListener("input", (event) => { if (event.target.matches("input")) validate(event.target); });
  form.addEventListener("submit", (event) => { event.preventDefault(); const inputs = [...form.querySelectorAll("input")]; if (!inputs.every(validate)) return form.querySelector(".is-invalid").focus(); const success = form.querySelector(".auth-success"); success.textContent = form.dataset.view === "forgot" ? "Hướng dẫn đặt lại mật khẩu đã được gửi tới email của bạn." : "Thông tin hợp lệ. Bạn đã sẵn sàng tiếp tục!"; success.hidden = false; });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) close(); });
}

function normalize(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
}
