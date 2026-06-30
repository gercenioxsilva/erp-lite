import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/api/paged_list.dart';
import 'package:orquestra_mobile/core/i18n/strings_pt_br.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';
import 'package:orquestra_mobile/core/widgets/empty_state.dart';
import 'package:orquestra_mobile/core/widgets/error_card.dart';
import 'package:orquestra_mobile/core/widgets/loading_overlay.dart';
import 'package:orquestra_mobile/core/widgets/paginated_list_view.dart';

/// Corpo padrão de uma listagem: barra de busca + estados
/// (loading/error/empty/data) com scroll infinito.
class PagedListBody<T> extends StatefulWidget {
  const PagedListBody({
    super.key,
    required this.state,
    required this.onSearch,
    required this.onRefresh,
    required this.onLoadMore,
    required this.itemBuilder,
    this.searchHint,
    this.emptyMessage,
    this.showSearch = true,
  });

  final PagedListState<T> state;
  final ValueChanged<String> onSearch;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onLoadMore;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final String? searchHint;
  final String? emptyMessage;
  final bool showSearch;

  @override
  State<PagedListBody<T>> createState() => _PagedListBodyState<T>();
}

class _PagedListBodyState<T> extends State<PagedListBody<T>> {
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (widget.showSearch) _buildSearch(),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildSearch() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: TextField(
        controller: _searchCtrl,
        textInputAction: TextInputAction.search,
        onSubmitted: widget.onSearch,
        decoration: InputDecoration(
          hintText: widget.searchHint ?? S.search,
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _searchCtrl.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.clear),
                  onPressed: () {
                    _searchCtrl.clear();
                    widget.onSearch('');
                  },
                ),
          contentPadding: const EdgeInsets.symmetric(vertical: 0),
        ),
        onChanged: (_) => setState(() {}),
      ),
    );
  }

  Widget _buildBody() {
    final state = widget.state;
    if (state.status == PagedStatus.loading && state.items.isEmpty) {
      return const LoadingOverlay();
    }
    if (state.status == PagedStatus.error && state.items.isEmpty) {
      return ErrorCard(
        message: state.error ?? S.errorGeneric,
        onRetry: widget.onRefresh,
      );
    }
    if (state.items.isEmpty) {
      return RefreshIndicator(
        color: AppColors.primary,
        onRefresh: widget.onRefresh,
        child: ListView(
          children: [
            SizedBox(
              height: 400,
              child: EmptyState(
                message: widget.emptyMessage ?? S.emptyDefault,
              ),
            ),
          ],
        ),
      );
    }
    return PaginatedListView<T>(
      items: state.items,
      hasMore: state.hasMore,
      onRefresh: widget.onRefresh,
      onLoadMore: widget.onLoadMore,
      itemBuilder: widget.itemBuilder,
    );
  }
}
