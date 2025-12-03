"""
VideoNet Pro - P2P 파일 전송 시스템
무손실, 최소 대역폭 파일 전송
"""

import os
import hashlib
import asyncio
from typing import Dict, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import aiofiles
from pathlib import Path

router = APIRouter(prefix="/api/files", tags=["File Transfer"])

# 파일 저장 디렉토리
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# 파일 메타데이터 저장
file_metadata: Dict[str, dict] = {}


def calculate_file_hash(file_path: str) -> str:
    """파일의 SHA256 해시 계산 (무결성 검증용)"""
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    room_id: str = None
):
    """
    파일 업로드 (청크 기반)
    - 무손실 전송
    - 해시 검증
    """
    try:
        # 파일 저장 경로
        file_path = UPLOAD_DIR / file.filename

        # 파일 크기 추적
        total_size = 0

        # 청크 단위로 파일 저장
        async with aiofiles.open(file_path, 'wb') as f:
            while chunk := await file.read(8192):  # 8KB 청크
                await f.write(chunk)
                total_size += len(chunk)

        # 파일 해시 계산
        file_hash = calculate_file_hash(str(file_path))

        # 메타데이터 저장
        file_id = file_hash[:16]  # 짧은 ID 생성
        file_metadata[file_id] = {
            "filename": file.filename,
            "size": total_size,
            "hash": file_hash,
            "path": str(file_path),
            "room_id": room_id
        }

        return {
            "file_id": file_id,
            "filename": file.filename,
            "size": total_size,
            "hash": file_hash,
            "message": "파일이 성공적으로 업로드되었습니다"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 업로드 실패: {str(e)}")


@router.get("/download/{file_id}")
async def download_file(file_id: str):
    """
    파일 다운로드
    - 무손실 전송 보장
    """
    if file_id not in file_metadata:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    metadata = file_metadata[file_id]
    file_path = metadata["path"]

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일이 존재하지 않습니다")

    return FileResponse(
        file_path,
        filename=metadata["filename"],
        media_type="application/octet-stream"
    )


@router.get("/verify/{file_id}")
async def verify_file(file_id: str, client_hash: str):
    """
    파일 무결성 검증
    - 클라이언트 해시와 서버 해시 비교
    """
    if file_id not in file_metadata:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    metadata = file_metadata[file_id]
    server_hash = metadata["hash"]

    is_valid = (client_hash == server_hash)

    return {
        "file_id": file_id,
        "filename": metadata["filename"],
        "is_valid": is_valid,
        "server_hash": server_hash,
        "client_hash": client_hash,
        "message": "파일이 정상적으로 전송되었습니다" if is_valid else "파일이 손상되었습니다"
    }


@router.get("/metadata/{file_id}")
async def get_file_metadata(file_id: str):
    """파일 메타데이터 조회"""
    if file_id not in file_metadata:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    return file_metadata[file_id]


@router.delete("/delete/{file_id}")
async def delete_file(file_id: str):
    """파일 삭제"""
    if file_id not in file_metadata:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")

    metadata = file_metadata[file_id]
    file_path = metadata["path"]

    # 파일 삭제
    if os.path.exists(file_path):
        os.remove(file_path)

    # 메타데이터 삭제
    del file_metadata[file_id]

    return {"message": "파일이 삭제되었습니다"}
