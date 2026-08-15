import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OfflineBanner, OfflineScreen } from '@/components/OfflineNotice';
import { strings } from '@/lib/strings';
import { setOnline } from '@/testing/online';
import { renderWithProviders } from '@/testing/render';

describe('OfflineBanner', () => {
  it('stays out of the way while there is a connection', () => {
    renderWithProviders(<OfflineBanner />);

    expect(screen.queryByText(strings.offline.banner)).not.toBeInTheDocument();
  });

  it('appears when the connection drops and goes again when it returns', () => {
    renderWithProviders(<OfflineBanner />);

    act(() => {
      setOnline(false);
    });
    expect(screen.getByText(strings.offline.banner)).toBeInTheDocument();

    act(() => {
      setOnline(true);
    });
    expect(screen.queryByText(strings.offline.banner)).not.toBeInTheDocument();
  });

  it('shows the state the page was already in when it mounted', () => {
    setOnline(false);

    renderWithProviders(<OfflineBanner />);

    expect(screen.getByText(strings.offline.banner)).toBeInTheDocument();
  });
});

describe('OfflineScreen', () => {
  it('explains why nothing can be shown', () => {
    renderWithProviders(<OfflineScreen />);

    expect(screen.getByText(strings.offline.title)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(strings.offline.text);
    expect(screen.getByText(strings.offline.hint)).toBeInTheDocument();
  });

  it('offers the retry only where there is something to retry', async () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithProviders(<OfflineScreen />);

    expect(screen.queryByRole('button', { name: strings.common.retry })).not.toBeInTheDocument();

    rerender(<OfflineScreen onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: strings.common.retry }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
