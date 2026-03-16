import type React from 'react'

interface DeleteCategoryModalProps {
  isOpen: boolean
  categoryName: string | null
  confirmButtonRef: React.RefObject<HTMLButtonElement>
  onConfirm: () => void
  onClose: () => void
}

export default function DeleteCategoryModal({
  isOpen,
  categoryName,
  confirmButtonRef,
  onConfirm,
  onClose
}: DeleteCategoryModalProps): JSX.Element {
  return (
    <div
      id="deleteCategoryModal"
      className="modal"
      style={{ display: isOpen ? 'flex' : 'none' }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h3>Delete Category</h3>
          <span id="closeDeleteCategoryModalBtn" className="close-modal" title="Close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256">
              <path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path>
            </svg>
          </span>
        </div>
        <p id="deleteCategoryMessage" className="modal-message">
          Delete "<strong>{categoryName || ''}</strong>" and remove the timestamps saved inside it?
        </p>
        <div className="modal-buttons">
          <button id="cancelDeleteCategoryBtn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button id="confirmDeleteCategoryBtn" ref={confirmButtonRef} type="button" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
