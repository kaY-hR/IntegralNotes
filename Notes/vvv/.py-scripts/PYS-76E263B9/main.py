import os
import time
from multiprocessing import freeze_support
from sys import exit
from threading import Thread
from typing import List

import cmdstanpy
from flask import Flask, Response, jsonify, make_response, request, session

from AppSessionControl.OperationSessionControl import SessionControl
from AppSessionControl.RelayFlask import (
    BayesAction,
    CommonAction,
    ExperimentalDesignAction,
    GradientAction,
    LeastSquaresAction,
    MSSpectraDechargerAction
)
from CommonClass.CommonResult import ApiResult, ErrorCode
from CommonClass.Log import BaseLog
from DesignSpace.BayesianRegression.BayesianModel import Bayesian
from objectbuilder import MAPPING_ROOT_CLASS, ObjectBuilder

app = Flask(__name__)
JsonLog = BaseLog("ReceiveJson")
ReturnJsonLog = BaseLog("ReturnJson")

"""
    ExperimentalDesign
"""


@app.route("/CreateDOE", methods=["POST"])
def CreateDOE():
    apiName = "CreateDOE"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = ExperimentalDesignAction.GetInstance().CreateDOE(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


"""
    Bayes
"""


@app.route("/Bayes/RunCompoundRegression", methods=["POST"])
def BayesRunCompoundRegression():
    apiName = "Bayes/RunCompoundRegression"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = BayesAction.GetInstance().RunCompoundRegression(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/Bayes/GetModelEvaluationValue", methods=["POST"])
def BayesGetModelEvaluationValue():
    apiName = "Bayes/GetModelEvaluationValue"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = BayesAction.GetInstance().GetModelEvaluationValue(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


"""
    LeastSquares
"""


@app.route("/LeastSquares/RunCompoundRegression", methods=["POST"])
def LeastSquaresRunCompoundRegression():
    apiName = "LeastSquares/RunCompoundRegression"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = LeastSquaresAction.GetInstance().RunCompoundRegression(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/LeastSquares/RunDirectRegression", methods=["POST"])
def LeastSquaresRunDirectRegression():
    apiName = "LeastSquares/RunDirectRegression"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = LeastSquaresAction.GetInstance().RunDirectRegression(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/LeastSquares/GetModelEvaluationValue", methods=["POST"])
def LeastSquaresGetModelEvaluationValue():
    apiName = "LeastSquares/GetModelEvaluationValue"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = LeastSquaresAction.GetInstance().GetModelEvaluationValue(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/LeastSquares/CreateDRDS", methods=["POST"])
def LeastSquaresCreateDRDS():
    apiName = "LeastSquares/CreateDRDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = LeastSquaresAction.GetInstance().CreateDRDS(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/LeastSquares/GetModelEvaluationValueDR", methods=["POST"])
def LeastSquaresGetModelEvaluationValueDR():
    apiName = "LeastSquares/GetModelEvaluationValueDR"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = LeastSquaresAction.GetInstance().GetModelEvaluationValueDR(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


"""
    共通処理
"""


@app.route("/GetSessionIDProgress", methods=["POST"])
def GetSessionIDProgress():
    apiName = "GetSessionIDProgress"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().GetSessionIDProgress(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateResolutionDS", methods=["POST"])
def CreateResolutionDS():
    apiName = "CreateResolutionDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().CreateResolutionDS(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateSpecificResolutionBetweenCompoundsDS", methods=["POST"])
def CreateSpecificResolutionBetweenCompoundsDS():
    apiName = "CreateSpecificResolutionBetweenCompoundsDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().CreateSpecificResolutionBetweenCompoundsDS(
        request.json
    )
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreatePeakNumberDS", methods=["POST"])
def CreatePeakNumberDS():
    apiName = "CreatePeakNumberDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().CreatePeakNumberDS(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateSummaryValueDS", methods=["POST"])
def CreateSummaryValueDS():
    apiName = "CreateSummaryValueDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().CreateSummaryValueDS(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetPredictedChromatogramValue", methods=["POST"])
def GetPredictedChromatogramValue():
    apiName = "GetPredictedChromatogramValue"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().GetPredictedChromatogramValue(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateSpecificCompoundResolutionDS", methods=["POST"])
def CreateSpecificCompoundResolutionDS():
    apiName = "CreateSpecificCompoundResolutionDS"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().CreateSpecificCompoundResolutionDS(
        request.json
    )
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/AbortRegression", methods=["POST"])
def AbortRegression():
    apiName = "AbortRegression"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().AbortRegression(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/AbortCreateOptimumGradient", methods=["POST"])
def AbortCreateOptimumGradient():
    apiName = "AbortCreateOptimumGradient"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().AbortCreateOptimumGradient(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/AbortCalcGradientCoefficient", methods=["POST"])
def AbortCalcGradientCoefficient():
    apiName = "AbortCalcGradientCoefficient"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().AbortCalcGradientCoefficient(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue

@app.route("/AbortCreateOptimumGradientForGetOptimumGradientResult", methods=["POST"])
def AbortCreateOptimumGradientForGetOptimumGradientResult():
    apiName = "AbortCreateOptimumGradientForGetOptimumGradientResult"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().AbortCreateOptimumGradientForGetOptimumGradientResult(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/DeleteTmpFolder", methods=["POST"])
def DeleteTmpFolder():
    apiName = "DeleteTmpFolder"
    # JsonLog.WriteLog("Received " + apiName + " command.", BaseLog.LogType.E_INFO)
    # 別スレッドでキックする。
    try:
        th = Thread(target=InitCmdStanTmpFolder)
        th.setDaemon(True)
        th.start()
    except Exception as ex:
        result = ApiResult(ErrorCode.CREATE_THREAD_FAILED)
        result.Header.Message = str(ex)
        return result
    # 非同期で制御を戻す。
    retValue = jsonify(ApiResult(ErrorCode.SUCCESS).GetResults())
    # WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


"""
    Gradient Simulation
"""


@app.route("/GetGradientModelValue", methods=["POST"])
def GetGradientModelValue():
    apiName = "GetGradientModelValue"
    # WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = CommonAction.GetInstance().GetGradientModelValue(request.json)
    retValue = jsonify(response.GetResults())
    # WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CalcGradientCoefficient", methods=["POST"])
def CalcGradientCoefficient():
    apiName = "CalcGradientCoefficient"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().CalcGradientCoefficient(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetCalcGradientCoefficientResult", methods=["POST"])
def GetCalcGradientCoefficientResult():
    apiName = "GetCalcGradientCoefficientResult"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetCalcGradientCoefficientResult(
        request.json
    )
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateOptimumGradient", methods=["POST"])
def CreateOptimumGradient():
    apiName = "CreateOptimumGradient"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().CreateOptimumGradient(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetOptimumGradientProgress", methods=["POST"])
def GetOptimumGradientProgress():
    apiName = "GetOptimumGradientProgress"
    # WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetOptimumGradientProgress(request.json)
    retValue = jsonify(response.GetResults())
    # WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetOptimumGradientResult", methods=["POST"])
def GetOptimumGradientResult():
    apiName = "GetOptimumGradientResult"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetOptimumGradientResult(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetCurrentSearchingGradient", methods=["POST"])
def GetCurrentSearchingGradient():
    apiName = "GetCurrentSearchingGradient"
    # WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetCurrentSearchingGradient(request.json)
    retValue = jsonify(response.GetResults())
    # WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/CreateCompoundTable", methods=["POST"])
def CreateCompoundTable():
    apiName = "CreateCompoundTable"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().CreateCompoundTable(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetCreateCompoundTableProgress", methods=["POST"])
def GetCreateCompoundTableProgress():
    apiName = "GetCreateCompoundTableProgress"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetCreateCompoundTableProgress(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetCompoundTableResult", methods=["POST"])
def GetCompoundTableResult():
    apiName = "GetCompoundTableResultResult"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetCompoundTableResult(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue


@app.route("/GetDiscriminantAnalysisResult", methods=["POST"])
def GetDiscriminantAnalysisResult():
    apiName = "GetDiscriminantAnalysisResult"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = GradientAction.GetInstance().GetDiscriminantAnalysisResult(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue

"""
    MSSpectraDecharger
    
"""

@app.route("/GetMSSpectraDecharger", methods=["POST"])
def GetMSSpectraDecharger():
    """
        多価イオン解析結果を返す

    """

    apiName = "GetMSSpectraDecharger"
    WriteJsonLog(JsonLog, apiName, str(request.json), True)
    response = MSSpectraDechargerAction.GetInstance().GetMSSpectraDecharger(request.json)
    retValue = jsonify(response.GetResults())
    WriteJsonLog(ReturnJsonLog, apiName, str(retValue.json), False)
    return retValue

def WriteJsonLog(logObject, apiName, jsonString, receiveFlag):
    try:
        jsonString = (
            jsonString.replace("None", "null")
            .replace(r"'", r'"')
            .replace("True", "true")
            .replace("False", "false")
        )
        msg = (
            "Received " + apiName + " command. Received json data : "
            if receiveFlag
            else apiName + " command. Return json data : "
        )
        logObject.WriteLog(msg + jsonString, BaseLog.LogType.E_INFO)
    except Exception as e:
        pass


def InitCmdStanTmpFolder():
    """
    cmdStanのTMPフォルダを初期化する。
    """
    try:
        # ロック開始
        CommonAction.GetInstance().RunRegressionLock = True
        while len(CommonAction.GetInstance().DoRunRegression) > 0:
            time.sleep(5)

        # TMPフォルダ生成
        if os.path.exists(cmdstanpy._TMPDIR):
            cmdstanpy._cleanup_tmpdir()

        if not os.path.exists(cmdstanpy._TMPDIR):
            os.makedirs(cmdstanpy._TMPDIR)
        # ロック解除
        CommonAction.GetInstance().RunRegressionLock = False
    except Exception as ex:
        log = BaseLog()
        log.WriteLog("Failed to create cmdstan tmp dir...", log.LogType.E_ERROR)
        log.WriteLog(ex, log.LogType.E_ERROR)
        result = ApiResult(ErrorCode.APP_EXCEPTION)
        result.Header.Message = str(ex)
        return result
    return ApiResult(ErrorCode.SUCCESS)


def cleanup_mei():
    """
    Rudimentary workaround for https://github.com/pyinstaller/pyinstaller/issues/2379
    """
    import os
    import sys
    from shutil import rmtree

    mei_bundle = getattr(sys, "_MEIPASS", False)

    if mei_bundle:
        dir_mei, current_mei = mei_bundle.split("_MEI")
        for file in os.listdir(dir_mei):
            if file.startswith("_MEI") and not file.endswith(current_mei):
                try:
                    rmtree(os.path.join(dir_mei, file))
                except PermissionError:  # mainly to allow simultaneous pyinstaller instances
                    pass


if __name__ == "__main__":
    import socket
    from os import environ

    # PyInstallerでmultiprocessingを使うために必要
    freeze_support()

    # tempフォルダの削除
    cleanup_mei()

    ProgramData = os.getenv("PROGRAMDATA")
    Datafolder = os.path.join(ProgramData, "Shimadzu\\MethodScoutingSolution")
    if not os.path.exists(Datafolder):
        os.makedirs(Datafolder)

    # ローカルホスト固定で起動
    HOST = "localhost"
    try:
        PORT = int(environ.get("CALCSERVICE_SVRPORT", "5000"))
    except ValueError:
        PORT = 5000
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((HOST, PORT))
        except:
            log = BaseLog()
            log.WriteLog("Port is in use.", log.LogType.E_ERROR)
            # 割り当てたポートが使用済みならアプリケーション終了
            exit()

    try:
        # DB生成
        SessionControl.GetInstance()
    except Exception as ex:
        # DB生成失敗したのでログ出力して終了する。
        log = BaseLog()
        log.WriteLog("Failed to create database file...", log.LogType.E_ERROR)
        log.WriteLog(ex, log.LogType.E_ERROR)
        exit()

    # TMPフォルダ生成
    if ErrorCode.SUCCESS.value["Status"] != InitCmdStanTmpFolder().Header.Status:
        exit()

    try:
        # ベイズ用stanファイル処理
        # 起動時にロードしてクラス変数に保持しておく。
        Bayesian()
    except Exception as ex:
        log = BaseLog()
        log.WriteLog("Failed to load stan file...", log.LogType.E_ERROR)
        log.WriteLog(ex, log.LogType.E_ERROR)
        exit()

    app.run(HOST, PORT)
