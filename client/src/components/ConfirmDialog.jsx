import { useState } from 'react';
import { Modal } from './Modal.jsx';

/**
 * In-app replacement for window.confirm().
 * const [confirmEl, ask] = useConfirm();  …  ask({ title, message, confirmLabel, danger }, () => doIt());
 */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const close = () => setReq(null);
  const el = req && (
    <Modal title={req.title} onClose={close}>
      {req.message && <p className="confirm-message">{req.message}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={close} autoFocus>
          Cancel
        </button>
        <button
          className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => {
            close();
            req.onConfirm();
          }}
        >
          {req.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  );
  const ask = (opts, onConfirm) => setReq({ ...opts, onConfirm });
  return [el, ask];
}
