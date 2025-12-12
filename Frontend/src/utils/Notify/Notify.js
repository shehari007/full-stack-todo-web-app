import { App } from "antd";

// Hook-based notification - use this in components
export const useNotify = () => {
  const { notification, message } = App.useApp();

  return {
    success: (title, desc) => {
      notification.success({
        placement: 'topRight',
        message: title,
        description: desc,
      });
    },
    warning: (title, desc) => {
      notification.warning({
        placement: 'topRight',
        message: title,
        description: desc,
      });
    },
    error: (title, desc) => {
      notification.error({
        placement: 'topRight',
        message: title,
        description: desc,
      });
    },
    info: (title, desc) => {
      notification.info({
        placement: 'topRight',
        message: title,
        description: desc,
      });
    },
    // Quick toast messages
    toast: {
      success: (content) => message.success(content),
      error: (content) => message.error(content),
      warning: (content) => message.warning(content),
      info: (content) => message.info(content),
      loading: (content) => message.loading(content),
    }
  };
};

export default useNotify;

