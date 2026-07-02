import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const siteUrl = 'https://durqan.ru';
const siteName = 'Durqan';
const defaultTitle = 'Durqan - социальная сеть для общения';
const defaultDescription = 'Durqan - социальная сеть для общения, профилей, публикаций, друзей и личных сообщений.';
const defaultImage = `${siteUrl}/pwa-icon-512.png`;

type SeoConfig = {
    title: string;
    description: string;
    robots?: string;
    lang?: string;
    locale?: string;
};

function getSeoConfig(pathname: string): SeoConfig {
    if (pathname === '/privacy') {
        return {
            title: 'Privacy Policy - Durqan',
            description: 'Privacy Policy for Durqan, including account data, encrypted messages, attachments, push notifications, cookies, and data rights.',
            lang: 'en',
            locale: 'en_US',
        };
    }

    if (pathname === '/account-deletion') {
        return {
            title: 'Account and Data Deletion - Durqan',
            description: 'How to request deletion of a Durqan account and associated data.',
            lang: 'en',
            locale: 'en_US',
        };
    }

    if (pathname === '/register') {
        return {
            title: 'Durqan - регистрация',
            description: 'Создайте профиль в Durqan, добавляйте друзей, публикуйте записи и обменивайтесь сообщениями.',
        };
    }

    if (pathname === '/login') {
        return {
            title: 'Durqan - вход',
            description: 'Войдите в Durqan, чтобы общаться с друзьями, читать обновления и отправлять личные сообщения.',
        };
    }

    if (pathname.startsWith('/users/') || pathname.startsWith('/verify-email/')) {
        return {
            title: siteName,
            description: defaultDescription,
            robots: 'noindex, nofollow',
        };
    }

    return {
        title: defaultTitle,
        description: defaultDescription,
    };
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);

    if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
    }

    element.content = content;
}

function setCanonical(href: string) {
    let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!element) {
        element = document.createElement('link');
        element.rel = 'canonical';
        document.head.appendChild(element);
    }

    element.href = href;
}

function canonicalUrl(pathname: string) {
    const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
    return `${siteUrl}${normalizedPath}`;
}

export function Seo() {
    const location = useLocation();

    useEffect(() => {
        const config = getSeoConfig(location.pathname);
        const canonical = canonicalUrl(location.pathname);
        const robots = config.robots ?? 'index, follow';

        document.documentElement.lang = config.lang ?? 'ru';
        document.title = config.title;

        setCanonical(canonical);
        setMeta('name', 'description', config.description);
        setMeta('name', 'robots', robots);
        setMeta('name', 'application-name', siteName);
        setMeta('property', 'og:site_name', siteName);
        setMeta('property', 'og:type', 'website');
        setMeta('property', 'og:locale', config.locale ?? 'ru_RU');
        setMeta('property', 'og:url', canonical);
        setMeta('property', 'og:title', config.title);
        setMeta('property', 'og:description', config.description);
        setMeta('property', 'og:image', defaultImage);
        setMeta('name', 'twitter:card', 'summary');
        setMeta('name', 'twitter:title', config.title);
        setMeta('name', 'twitter:description', config.description);
        setMeta('name', 'twitter:image', defaultImage);
    }, [location.pathname]);

    return null;
}
