from fastapi import APIRouter
from .pages import router as pages_router
from .merge import router as merge_router
from .split import router as split_router
from .history import router as history_router
from .utils import router as utils_router

router = APIRouter()
router.include_router(pages_router)
router.include_router(merge_router)
router.include_router(split_router)
router.include_router(history_router)
router.include_router(utils_router)
