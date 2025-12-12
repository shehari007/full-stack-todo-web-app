import AxiosRequest from '../ApiRequest/ApiRequest';

const GetAllTodoList = async () => {
    try {
        const response = await AxiosRequest.get('/api/todos');
        if (response.status === 200) {
            return response.data.todoList;
        } else {
            throw new Error('error getting list');
        }
    } catch (error) {
        console.log(error);
        return [];
    }
};

const CreateTodo = async (values) => {
    try {
        const response = await AxiosRequest.post('/api/todos', values);
        if (response.status === 201) {
            return true;
        } else {
            throw new Error('error creating task');
        }
    } catch (error) {
        console.log(error);
        return false;
    }
};

const UpdateTodo = async (values, todoID) => {
    try {
        const response = await AxiosRequest.put(`/api/todos/${todoID}`, values);
        if (response.status === 200) {
            return true;
        } else {
            throw new Error('error updating task');
        }
    } catch (error) {
        console.log(error);
        return false;
    }
};

const UpdateCheckTodo = async (todoID, checked) => {
    try {
        const response = await AxiosRequest.patch(`/api/todos/${todoID}/check`, { checked });
        if (response.status === 200) {
            return true;
        } else {
            throw new Error('error updating task');
        }
    } catch (error) {
        console.log(error);
        return false;
    }
};

const DelTodo = async (todoID) => {
    try {
        const response = await AxiosRequest.delete(`/api/todos/${todoID}`);
        if (response.status === 200) {
            return true;
        } else {
            throw new Error('error deleting task');
        }
    } catch (error) {
        console.log(error);
        return false;
    }
};

const TodoListService = {
    GetAllTodoList,
    CreateTodo,
    UpdateTodo,
    DelTodo,
    UpdateCheckTodo,
};

export default TodoListService;