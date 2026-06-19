export const getAppAuthRedirectUrl = () => {
  const basePath = import.meta.env.BASE_URL || '/';
  const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const origin = window.location.origin;

  return `${origin}${normalizedBasePath}`;
};

export const getAuthHashErrorMessage = () => {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash || rawHash.startsWith('/')) return null;

  const params = new URLSearchParams(rawHash);
  const error = params.get('error');
  const errorCode = params.get('error_code');
  const errorDescription = params.get('error_description');

  if (errorCode === 'otp_expired' || error === 'access_denied') {
    return 'Liên kết xác thực email đã hết hạn hoặc không hợp lệ. Vui lòng thực hiện đổi email lại để nhận liên kết mới.';
  }

  if (error || errorCode || errorDescription) {
    return 'Không thể xác thực email từ liên kết này. Vui lòng thực hiện đổi email lại để nhận liên kết mới.';
  }

  return null;
};
