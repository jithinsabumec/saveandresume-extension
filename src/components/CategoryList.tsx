import type { Categories } from '../types'
import editUrl from '../../edit.svg'
import addUrl from '../../add.svg'

interface CategoryListProps {
  categories: Categories
  activeCategory: string
  isEditMode: boolean
  onSelectCategory: (category: string) => void
  onAddCategory: () => void
  onToggleEditMode: () => void
  onDeleteCategory: (category: string) => void
}

const protectedCategoryNames = new Set(['Default'])

export default function CategoryList({
  categories,
  activeCategory,
  isEditMode,
  onSelectCategory,
  onAddCategory,
  onToggleEditMode,
  onDeleteCategory
}: CategoryListProps): JSX.Element {
  const sortedCategories = Object.keys(categories).sort((left, right) => left.localeCompare(right))
  const totalVideos = Object.values(categories).reduce((sum, videos) => sum + videos.length, 0)

  return (
    <>
      <div className="categories-header">
        <div className="categories-title">Categories</div>
        <div className="categories-actions">
          <button
            id="editCategoriesBtn"
            className="edit-category-button"
            title="Edit categories"
            type="button"
            style={{ display: isEditMode ? 'none' : 'flex' }}
            onClick={onToggleEditMode}
          >
            <img src={editUrl} width="14" height="14" alt="Edit" />
          </button>
          <button
            id="addCategoryBtn"
            className="add-category-button"
            title="Add category"
            type="button"
            style={{ display: isEditMode ? 'none' : 'flex' }}
            onClick={onAddCategory}
          >
            <img src={addUrl} width="14" height="14" alt="Add" />
          </button>
          <button
            id="saveCategoriesBtn"
            className="save-categories-button"
            title="Save changes"
            type="button"
            style={{ display: isEditMode ? 'flex' : 'none' }}
            onClick={onToggleEditMode}
          >
            Save
          </button>
        </div>
      </div>
      <div id="deleteModeHint" className="delete-mode-hint" aria-live="polite" style={{ display: isEditMode ? 'block' : 'none' }}>
        Delete mode: Tap a category or X, then confirm. Default stays.
      </div>
      <ul id="categoryList" className={`category-list${isEditMode ? ' edit-mode' : ''}`}>
        <li
          className={`category-item all-category${activeCategory === 'all' ? ' active' : ''}`}
          data-category="all"
          onClick={() => {
            if (!isEditMode) {
              onSelectCategory('all')
            }
          }}
        >
          <span className="category-name">All</span>
          <span className="category-count" id="allCategoryCount">
            {totalVideos}
          </span>
        </li>
        {sortedCategories.map((category) => {
          const isProtected = protectedCategoryNames.has(String(category || '').trim())
          return (
            <li
              key={category}
              className={`${isProtected ? 'category-item protected-category' : 'category-item can-delete'}${
                activeCategory === category ? ' active' : ''
              }`}
              data-category={category}
              title={isProtected ? `"${category}" can't be deleted` : undefined}
              onClick={() => {
                if (isEditMode) {
                  if (!isProtected) {
                    onDeleteCategory(category)
                  }
                  return
                }

                onSelectCategory(category)
              }}
            >
              <span className="category-name">{category}</span>
              <span className="category-count">{categories[category].length}</span>
              {!isProtected ? (
                <span
                  className="delete-category-btn"
                  title={`Delete "${category}"`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (isEditMode) {
                      onDeleteCategory(category)
                    }
                  }}
                  dangerouslySetInnerHTML={{
                    __html:
                      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"></path></svg>'
                  }}
                ></span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
