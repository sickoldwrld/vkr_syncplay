import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoteSkipBar, { type SkipVoteState } from '@/components/VoteSkipBar';

function state(p: Partial<SkipVoteState> = {}): SkipVoteState {
  return { votes: 0, required: 1, listeners: 1, voted: false, ...p };
}

describe('VoteSkipBar', () => {
  it('renders vote count and listener count', () => {
    render(<VoteSkipBar state={state({ votes: 2, required: 3, listeners: 5 })} onVote={() => {}} />);
    expect(screen.getByTestId('vote-skip-count')).toHaveTextContent('2/3 голосов');
    expect(screen.getByTestId('vote-skip').textContent).toMatch(/5\s*слушателей/);
  });

  it('fires onVote when the button is clicked', async () => {
    const onVote = vi.fn();
    render(<VoteSkipBar state={state()} onVote={onVote} />);
    await userEvent.click(screen.getByTestId('vote-skip-button'));
    expect(onVote).toHaveBeenCalledOnce();
  });

  it('label flips between "Скип" and "Голос подан" by voted state', () => {
    const { rerender } = render(<VoteSkipBar state={state({ voted: false })} onVote={() => {}} />);
    expect(screen.getByTestId('vote-skip-button')).toHaveTextContent('Скип');
    rerender(<VoteSkipBar state={state({ voted: true })} onVote={() => {}} />);
    expect(screen.getByTestId('vote-skip-button')).toHaveTextContent('Голос подан');
  });

  it('progress bar fills proportionally to votes/required (capped at 100%)', () => {
    const { rerender } = render(
      <VoteSkipBar state={state({ votes: 1, required: 4 })} onVote={() => {}} />,
    );
    expect(screen.getByTestId('vote-skip-progress')).toHaveStyle({ width: '25%' });
    rerender(<VoteSkipBar state={state({ votes: 9, required: 4 })} onVote={() => {}} />);
    expect(screen.getByTestId('vote-skip-progress')).toHaveStyle({ width: '100%' });
  });

  it('button is disabled when prop says so', async () => {
    const onVote = vi.fn();
    render(<VoteSkipBar state={state()} disabled onVote={onVote} />);
    const btn = screen.getByTestId('vote-skip-button');
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onVote).not.toHaveBeenCalled();
  });
});
