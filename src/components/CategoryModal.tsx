import type React from 'react'

interface CategoryModalProps {
  isOpen: boolean
  value: string
  inputRef: React.RefObject<HTMLInputElement>
  onSave: (name: string) => void
  onClose: () => void
  onChange: (value: string) => void
}

export default function CategoryModal({
  isOpen,
  value,
  inputRef,
  onSave,
  onClose,
  onChange
}: CategoryModalProps): JSX.Element {
  return (
    <div id="categoryModal" className="modal" style={{ display: isOpen ? 'block' : 'none' }}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Add New Category</h3>
          <span id="closeCategoryModalBtn" className="close-modal" title="Close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256">
              <path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path>
            </svg>
          </span>
        </div>
        <input
          ref={inputRef}
          type="text"
          id="categoryNameInput"
          placeholder="Category name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyPress={(event) => {
            if (event.key === 'Enter') {
              onSave(value)
            }
          }}
        />
        <div className="modal-buttons">
          <button id="saveCategoryBtn" type="button" onClick={() => onSave(value)}>
            Save
          </button>
          <button id="cancelCategoryBtn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
