import AxiosRequest from '../ApiRequest/ApiRequest';
import Notify from '../Notify/Notify';

const Login = async (values) => {
    try {
        const response = await AxiosRequest.post('/login', values);
        if (response.status === 200) {
            let data = response.data.finalData;
            console.log(response.data)
            sessionStorage.setItem('JWTAccessToken', data.JWTAccessToken);
            localStorage.setItem('User', data.userDetails);
            window.location.replace("/home/todolist");
        } else {
            throw new Error('error logging in');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Login', 'Login username or password incorrect!')
        return null;
    }
};

const Register = async (values) => {


    try {
        const response = await AxiosRequest.post('/register', values);
        if (response.status === 200) {
            Notify.success('Register', 'User registered successfully, Redirecting to Login Page...');
            setTimeout(() =>{
                window.location.replace("/login");
            }, 1500)
        } else if (response.status === 201) {
            Notify.warning('Register', 'Username is already registered');
        } 
        else {
            throw new Error('error registering user');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Register', 'Something went wrong, please try again later')
        return null;
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