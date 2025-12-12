import AxiosRequest from '../ApiRequest/ApiRequest';

const Login = async (values) => {
    try {
        const response = await AxiosRequest.post('/api/auth/login', values);
        if (response.status === 200) {
            const { JWTAccessToken, userDetails } = response.data.finalData;
            sessionStorage.setItem('JWTAccessToken', JWTAccessToken);
            localStorage.setItem('User', userDetails);
            window.location.replace('/dashboard');
            return { success: true };
        } else {
            throw new Error('error logging in');
        }
    } catch (error) {
        console.log(error);
        return { success: false, error: error.response?.data?.error || 'Login username or password incorrect!' };
    }
};

const Register = async (values) => {
    try {
        const response = await AxiosRequest.post('/api/auth/register', values);
        if (response.status === 201) {
            return { success: true, message: 'User registered successfully!' };
        } else {
            throw new Error('error registering user');
        }
    } catch (error) {
        console.log(error);
        // Handle 409 Conflict (duplicate username)
        if (error.response?.status === 409) {
            return { success: false, error: 'Username is already registered' };
        }
        return { success: false, error: error.response?.data?.error || 'Something went wrong, please try again later' };
    }
};

const LogOut = () => {
    sessionStorage.removeItem('JWTAccessToken');
    localStorage.removeItem('User');
    window.location.replace('/login');
}


const AuthService = {
    Login,
    Register,
    LogOut
}
export default AuthService