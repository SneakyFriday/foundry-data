/**
 * Simple utility class to inject a custom button to the window header.
 */
export class HtmlUtils {

    static appendHeaderButton(html, title, fn) {
        const openBtn = document.createElement('a');
        openBtn.className = 'translate';
        openBtn.title = title;
        openBtn.innerHTML = `<i class="fas fa-globe"></i> ${title}`;
        openBtn.addEventListener('click', fn);
        html.querySelector('.translate')?.remove();
        const titleElement = html.querySelector('.window-title');
        titleElement?.parentNode.insertBefore(openBtn, titleElement.nextSibling);
    }
}
