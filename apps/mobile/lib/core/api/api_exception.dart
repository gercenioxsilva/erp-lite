/// Erros normalizados da camada de API (Regra Mobile-8).
sealed class ApiException implements Exception {
  const ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// HTTP 422 — regra de negócio violada (DomainError no backend).
final class DomainException extends ApiException {
  const DomainException(super.message);
}

/// HTTP 400/404/409 e demais erros de requisição.
final class RequestException extends ApiException {
  const RequestException(super.message, this.statusCode);
  final int statusCode;
}

/// HTTP 401 — sessão inválida; o interceptor limpa o token e volta ao login.
final class AuthException extends ApiException {
  const AuthException([super.message = 'Sessão expirada']);
}

/// Falha de conexão / timeout — sem resposta do servidor.
final class NetworkException extends ApiException {
  const NetworkException([super.message = 'Sem conexão com o servidor']);
}

/// HTTP 5xx — erro interno do servidor.
final class ServerException extends ApiException {
  const ServerException([super.message = 'Erro interno — tente novamente']);
}
