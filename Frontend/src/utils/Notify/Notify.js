import { notification } from "antd";

const success = (title, desc) => {
  notification.open({
    placement: 'topRight',
    message: title,
    type: 'success',
    description:
      desc
  });
}

const warning = (title, desc) => {
  notification.open({
    placement: 'topRight',
    message: title,
    type: 'warning',
    description:
      desc
  });
}

const error = (title, desc) => {
  notification.open({
    placement: 'topRight',
    message: title,
    type: 'error',
    description:
      desc
  });
}

const Notify = {
  success,
  warning,
  error
}

export default Notify

