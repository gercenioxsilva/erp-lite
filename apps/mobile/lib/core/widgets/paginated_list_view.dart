import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

/// ListView com pull-to-refresh + scroll infinito (Regra Mobile-7).
/// Dispara [onLoadMore] ao se aproximar do fim quando [hasMore] é true.
class PaginatedListView<T> extends StatefulWidget {
  const PaginatedListView({
    super.key,
    required this.items,
    required this.itemBuilder,
    required this.onRefresh,
    required this.onLoadMore,
    required this.hasMore,
    this.separator,
    this.padding = const EdgeInsets.all(16),
  });

  final List<T> items;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onLoadMore;
  final bool hasMore;
  final Widget? separator;
  final EdgeInsets padding;

  @override
  State<PaginatedListView<T>> createState() => _PaginatedListViewState<T>();
}

class _PaginatedListViewState<T> extends State<PaginatedListView<T>> {
  final ScrollController _controller = ScrollController();
  bool _loadingMore = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
  }

  @override
  void dispose() {
    _controller.removeListener(_onScroll);
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!widget.hasMore || _loadingMore) return;
    final position = _controller.position;
    if (position.pixels >= position.maxScrollExtent - 300) {
      _triggerLoadMore();
    }
  }

  Future<void> _triggerLoadMore() async {
    setState(() => _loadingMore = true);
    try {
      await widget.onLoadMore();
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final itemCount = widget.items.length + (widget.hasMore ? 1 : 0);
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: widget.onRefresh,
      child: ListView.separated(
        controller: _controller,
        padding: widget.padding,
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: itemCount,
        separatorBuilder: (_, __) =>
            widget.separator ?? const SizedBox(height: 10),
        itemBuilder: (context, index) {
          if (index >= widget.items.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(
                child: SizedBox(
                  height: 24,
                  width: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          return widget.itemBuilder(context, widget.items[index], index);
        },
      ),
    );
  }
}
