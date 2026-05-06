const footerTarget = document.getElementById('footer-placeholder');

if (footerTarget) {
  fetch('/components/footer.html')
    .then((response) => response.text())
    .then((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const footer = doc.querySelector('footer');
      if (footer) {
        footerTarget.replaceChildren(footer);
      }
    })
    .catch((error) => {
      console.warn(
        'Failed to load footer from /components/footer.html. Verify static hosting for /components and check network connectivity.',
        error
      );
    });
}
