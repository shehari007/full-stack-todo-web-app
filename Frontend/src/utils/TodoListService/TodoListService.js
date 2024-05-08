import AxiosRequest from '../ApiRequest/ApiRequest';
import Notify from '../Notify/Notify';

const GetAllTodoList = async () => {
    try {
        const response = await AxiosRequest.get('/getAll');
        if (response.status === 200) {
            return response.data.todoList
        } else {
            throw new Error('error getting list');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Todo List', 'Error Getting List!')
        return [];
    }
};

const CreateTodo = async (values) => {
    try {
        const response = await AxiosRequest.post('/create', values);
        if (response.status === 200) {
            Notify.success('Todo List', 'Todo Task created successfully!');
            return true;
        } else {
            throw new Error('error creating task');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Todo List', 'Error Creating Task!')
        return false;
    }
};

const UpdateTodo = async (values, todoID) => {
    console.log(values.id)
    try {
        const response = await AxiosRequest.put(`/update/${todoID}`, values);
        if (response.status === 200) {
            Notify.success('Todo List', 'Todo Task updated successfully!');
            return true;
        } else {
            throw new Error('error updating task');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Todo List', 'Error Updating Task!')
        return false;
    }
};

const UpdateCheckTodo = async (todoID, checked) => {
    try {
        const response = await AxiosRequest.put(`/updateCheck/${todoID}`, { checked: checked });
        if (response.status === 200) {
            if (checked === true) {
                Notify.success('Todo List', 'Todo Task Set Completed successfully!');
            }
            else {
                Notify.success('Todo List', 'Todo Task Set incompleted successfully!');
            }
            return true;
        } else {
            throw new Error('error updating task');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Todo List', 'Error Updating Task!')
        return false;
    }
};


const DelTodo = async (todoID) => {
    try {
        const response = await AxiosRequest.delete(`/delete/${todoID}`);
        if (response.status === 200) {
            Notify.success('Todo List', 'Todo Task deleted successfully!');
            return true;
        } else {
            throw new Error('error deleting task');
        }
    }
    catch (error) {
        console.log(error)
        Notify.error('Todo List', 'Error Deleting Task!')
        return false;
    }
};

const TodoListService = {
    GetAllTodoList,
    CreateTodo,
    UpdateTodo,
    DelTodo,
    UpdateCheckTodo
}
export default TodoListService