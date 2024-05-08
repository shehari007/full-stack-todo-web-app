import axios from 'axios';

const AxiosRequest = axios.create({
    headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
    },
    baseURL: process.env.REACT_APP_BASE_URL,
});

AxiosRequest.interceptors.request.use(config => {

    const token = window.sessionStorage.getItem('JWTAccessToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

export default AxiosRequest;
