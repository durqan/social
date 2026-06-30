export type IconName = 'arrowLeft' | 'arrowDown' | 'close' | 'delete' | 'edit' | 'send' | 'search' | 'logout' | 'menu' | 'more' | 'home' | 'wall' | 'friends' | 'messages' | 'heart' | 'bell' | 'phone' | 'phoneOff' | 'mic' | 'micOff' | 'video' | 'videoOff' | 'switchCamera' | 'maximize' | 'minimize' | 'image' | 'paperclip' | 'file' | 'audio' | 'download' | 'share' | 'play' | 'pause' | 'pin' | 'info' | 'checkCircle' | 'warning' | 'smile';

interface IconProps {
    name: IconName;
    className?: string;
    filled?: boolean;
}

const paths: Record<IconName, string> = {
    arrowLeft: 'M10 19l-7-7m0 0l7-7m-7 7h18',
    arrowDown: 'M19 9l-7 7-7-7M12 16V4',
    close: 'M6 18L18 6M6 6l12 12',
    delete: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    edit: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
    send: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    menu: 'M4 6h16M4 12h16M4 18h16',
    more: 'M12 6h.01M12 12h.01M12 18h.01',
    home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    wall: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
    friends: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    messages: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    heart: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9',
    phone: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 15.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
    phoneOff: 'M16.49 12.49l-1.367 1.367a1 1 0 00-.23 1.09l.382.894a1 1 0 01-.21 1.09l-.54.54A11.02 11.02 0 016.53 9.475l.54-.54a1 1 0 011.09-.21l.894.382a1 1 0 001.09-.23l1.367-1.367M3 3l18 18',
    mic: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2m7 9v4m-4 0h8',
    micOff: 'M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 015 12v-2m14 0v2a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8',
    video: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
    videoOff: 'M1 1l22 22M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-.372.78M10.5 6H13a2 2 0 012 2v3.5M7.12 6H5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 001.74-1.02',
    switchCamera: 'M4 7h3l2-2h6l2 2h3a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2zM7 13a5 5 0 008.66 3.38M17 13a5 5 0 00-8.66-3.38M8 16H5v-3M16 10h3v3',
    maximize: 'M8 3H5a2 2 0 00-2 2v3m0 8v3a2 2 0 002 2h3m8-18h3a2 2 0 012 2v3m0 8v3a2 2 0 01-2 2h-3',
    minimize: 'M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3m8 0v-3a2 2 0 012-2h3',
    image: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
    file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h5',
    audio: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z',
    download: 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3',
    share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14',
    play: 'M8 5v14l11-7z',
    pause: 'M6 4h4v16H6V4zm8 0h4v16h-4V4z',
    pin: 'M14 4l6 6-3 3 2 2-2 2-2-2-4 4v3H9v-3l4-4-4-4-4 4H3l6-6-2-2 2-2 2 2 3-3z',
    info: 'M13 16h-1v-4h-1m1-4h.01M12 22a10 10 0 110-20 10 10 0 010 20z',
    checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    warning: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    smile: 'M9 10h.01M15 10h.01M9.5 15a4 4 0 005 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

export const Icon = ({ name, className = 'w-5 h-5', filled = false }: IconProps) => (
    <svg className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={paths[name]} />
    </svg>
);
