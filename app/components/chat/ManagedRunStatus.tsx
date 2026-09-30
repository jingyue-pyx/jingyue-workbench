import { useStore } from '@nanostores/react';
import { runState, adjustManagedPlan, confirmManagedPlan, planReviewReady } from '~/lib/runtime/managed/session';
import { toast } from 'react-toastify';
import { EngineeringPlan } from './EngineeringPlan';

export function ManagedRunStatus() {
  const state = useStore(runState);
  const ready = useStore(planReviewReady);

  /*
   * Only a pending plan is interactive, in its own chat message. No standalone
   * status dashboard and no changes to the workbench/preview split layout.
   */
  if (state.phase !== 'reviewing') {
    return null;
  }

  return (
    <section aria-label="对话方案选项" className="text-sm text-bolt-elements-textSecondary">
      {state.plan && state.phase === 'reviewing' && (
        <EngineeringPlan
          key={`${state.id}:${state.plan.questions.map((question) => question.id).join(',')}`}
          plan={state.plan}
          reviewing={state.phase === 'reviewing'}
          ready={ready}
          onConfirm={(answers) => {
            try {
              confirmManagedPlan(answers);
            } catch (error) {
              toast.error((error as Error).message);
            }
          }}
          onAdjust={adjustManagedPlan}
          reviewError={state.reviewError}
        />
      )}
    </section>
  );
}
