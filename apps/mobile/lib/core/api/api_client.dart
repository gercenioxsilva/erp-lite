import 'package:dio/dio.dart';
import 'package:orquestra_mobile/core/api/api_exception.dart';
import 'package:orquestra_mobile/core/api/endpoints.dart';
import 'package:orquestra_mobile/core/auth/secure_storage.dart';

/// Cliente HTTP central. Injeta JWT (header) e tenant_id (query) em toda
/// requisição autenticada, normaliza erros e dispara logout em 401.
///
/// O backend é misto: rotas novas leem tenantId do JWT; rotas legadas leem
/// tenant_id da query. Enviar ambos cobre todos os casos.
class ApiClient {
  ApiClient(this._storage) {
    _dio = Dio(
      BaseOptions(
        baseUrl: kApiBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        contentType: Headers.jsonContentType,
        responseType: ResponseType.json,
      ),
    );
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: _onRequest,
        onError: _onError,
      ),
    );
  }

  final SecureStorageLike _storage;
  late final Dio _dio;

  String? _token;
  String? _tenantId;

  /// Disparado em 401 — o app limpa a sessão e volta ao login.
  void Function()? onUnauthorized;

  String? get tenantId => _tenantId;
  bool get isAuthenticated => _token != null;

  /// Carrega sessão persistida na inicialização do app.
  Future<void> bootstrap() async {
    _token = await _storage.readToken();
    _tenantId = await _storage.readTenantId();
  }

  Future<void> setSession({
    required String token,
    required String tenantId,
  }) async {
    _token = token;
    _tenantId = tenantId;
    await _storage.saveSession(token: token, tenantId: tenantId);
  }

  Future<void> clearSession() async {
    _token = null;
    _tenantId = null;
    await _storage.clear();
  }

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = _token;
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    final tenantId = _tenantId;
    final isAuthRoute = options.path.startsWith('/v1/auth') ||
        options.path.startsWith('/v1/public');
    if (tenantId != null && !isAuthRoute) {
      options.queryParameters = <String, dynamic>{
        ...options.queryParameters,
        if (!options.queryParameters.containsKey('tenant_id'))
          'tenant_id': tenantId,
      };
    }
    handler.next(options);
  }

  Future<void> _onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode == 401) {
      await clearSession();
      onUnauthorized?.call();
    }
    handler.next(err);
  }

  // --- Métodos convenientes -------------------------------------------------

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? query,
  }) =>
      _request(() => _dio.get<dynamic>(path, queryParameters: query));

  Future<dynamic> post(String path, {Object? body}) =>
      _request(() => _dio.post<dynamic>(path, data: body));

  Future<dynamic> patch(String path, {Object? body}) =>
      _request(() => _dio.patch<dynamic>(path, data: body));

  Future<dynamic> put(String path, {Object? body}) =>
      _request(() => _dio.put<dynamic>(path, data: body));

  Future<dynamic> delete(String path, {Object? body}) =>
      _request(() => _dio.delete<dynamic>(path, data: body));

  Future<dynamic> _request(Future<Response<dynamic>> Function() run) async {
    try {
      final res = await run();
      return res.data;
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  ApiException _mapError(DioException e) {
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      return const NetworkException();
    }

    final status = e.response?.statusCode ?? 0;
    final message = _extractMessage(e.response?.data);

    if (status == 401) return AuthException(message ?? 'Sessão expirada');
    if (status == 422) {
      return DomainException(message ?? 'Operação inválida');
    }
    if (status >= 500) return const ServerException();
    if (status >= 400) {
      return RequestException(message ?? 'Requisição inválida', status);
    }
    return const NetworkException();
  }

  String? _extractMessage(Object? data) {
    if (data is Map) {
      final msg = data['message'] ?? data['error'];
      if (msg is String && msg.isNotEmpty) return msg;
    }
    return null;
  }
}
