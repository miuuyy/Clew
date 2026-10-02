(() => {
      try {
        const theme = localStorage.getItem("knowledge_graph_theme_mode_v1") === "light" ? "light" : "dark";
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.style.backgroundColor = theme === "light" ? "#ffffff" : "#000000";
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.setAttribute("content", theme === "light" ? "#ffffff" : "#050505");
        const metaScheme = document.querySelector('meta[name="color-scheme"]');
        if (metaScheme) metaScheme.setAttribute("content", theme === "light" ? "light" : "dark");
        const faviconHref = theme === "light" ? "/clew-favicon-light-accent.png" : "/clew-mark.svg";
        const iconLink = document.querySelector('link[rel="icon"]');
        const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
        if (iconLink) iconLink.setAttribute("href", faviconHref);
        if (appleTouchIcon) appleTouchIcon.setAttribute("href", faviconHref);
      } catch {}
    })();
