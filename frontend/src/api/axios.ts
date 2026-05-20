import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    timeout: 10000,
    withCredentials: true,
});

api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401 && !['/login', '/register', '/verify-email']
            .some(path => window.location.pathname.includes(path))) {
            window.location.href = '/login';
        }
        return Promise.reject(err);
    }
);

export default api;
